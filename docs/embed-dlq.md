# Embed Lambda failures: DLQ, alarm and redrive (RECIP-33)

The embed Lambda (`recipator-embed-{env}`) computes a recipe's semantic-search vector. If it
fails, the recipe is still saved and still keyword-searchable, but it never turns up in
semantic results. Before RECIP-33 such a failure was lost silently; now it is queued,
alarmed on and replayable.

## How the Lambda is invoked

There is no event source queue, EventBridge rule or stream. Every caller invokes it
**asynchronously** (`InvocationType=Event`) with a JSON payload:

| Caller | `source` | Payload |
|---|---|---|
| `POST /extract` (`lambda/extract/index.ts`) | `extract` | `recipeId`, `userId`, `title`, `ingredients` |
| `PATCH /recipes/{id}` (`lambda/recipes/update.ts`), when title or ingredients change | `update` | as above |
| `scripts/backfill-embeddings.sh` | `backfill` | `recipeId`, `userId` (keys only) |
| `scripts/redrive-embed-dlq.sh` | `redrive` | `recipeId`, `userId` (keys only) |

With keys only, the Lambda reads the current title and ingredients from the table.

## What happens on failure

1. The handler logs a structured `embed:failed` line to `/aws/lambda/recipator-embed-{env}`
   with `recipeId`, `userId`, `source`, `requestId`, `errorType`, `error`, and a
   keys-only `replay` payload. Then it re-raises.
2. Lambda's async retry runs the event **twice more** (`retryAttempts: 2`), with backoff.
   An event that has been waiting longer than **6 hours** (`maxEventAge`) is not retried.
3. Once the retries are spent, Lambda's **on-failure destination** sends an invocation
   record to the SQS queue `recipator-embed-dlq-{env}`, which keeps it for **14 days**.
4. The CloudWatch alarm `recipator-embed-dlq-not-empty-{env}` fires when
   `ApproximateNumberOfMessagesVisible > 0` (5-minute maximum, one period). It notifies
   the SNS topic `recipator-alerts-{env}`, and sends an OK notification when the queue
   is empty again.

A DLQ message body looks like this:

```json
{
  "version": "1.0",
  "timestamp": "2026-10-13T12:00:00.000Z",
  "requestContext": {
    "requestId": "…",
    "functionArn": "arn:aws:lambda:eu-west-2:…:function:recipator-embed-sandbox:$LATEST",
    "condition": "RetriesExhausted",
    "approximateInvokeCount": 3
  },
  "requestPayload": { "recipeId": "…", "userId": "…", "title": "…", "ingredients": ["…"], "source": "extract" },
  "responseContext": { "statusCode": 200, "executedVersion": "$LATEST", "functionError": "Unhandled" },
  "responsePayload": { "errorMessage": "…", "errorType": "…" }
}
```

`condition` is `RetriesExhausted` or `EventAgeExceeded`.

## Alert email subscription

The topic's email subscription comes from the `AlertEmail` stack parameter, so no address
is committed. It defaults to blank, and when it is blank no subscription is created. CDK
reuses a parameter's previous value on later deploys (including CI), so set it once per
account:

```bash
cd infra
AWS_PROFILE=nakom.is-sandbox NPM_ENVIRONMENT=sandbox \
  npx cdk deploy RecipatorApiStack --parameters RecipatorApiStack:AlertEmail=<address>
```

Confirm the subscription from the email that AWS sends. Use `nakom.is-admin` and `prod`
for production.

## Inspecting the DLQ

Start with the dry run. It prints up to 10 queued failures (recipe, source, condition,
error) and changes nothing:

```bash
cd infra
AWS_PROFILE=nakom.is-sandbox ./scripts/redrive-embed-dlq.sh sandbox --dry-run
```

To get the queue depth only:

```bash
aws sqs get-queue-attributes --region eu-west-2 \
  --queue-url "$(aws sqs get-queue-url --region eu-west-2 --queue-name recipator-embed-dlq-sandbox --query QueueUrl --output text)" \
  --attribute-names ApproximateNumberOfMessages
```

For the full error and stack trace, search the function's logs for the recipe in CloudWatch
Logs Insights (`/aws/lambda/recipator-embed-{env}`):

```
fields @timestamp, recipeId, source, errorType, error
| filter event = "embed:failed"
| sort @timestamp desc
```

## Redriving

1. **Fix the cause first.** Common causes are a bad image or model (check
   `publish-embed-image.sh` ran and the tag exists), a timeout or out-of-memory error
   (see the `REPORT` lines), or DynamoDB throttling. If the cause is still there, a
   redrive just sends the messages back to the DLQ.
2. Run the redrive:

   ```bash
   AWS_PROFILE=nakom.is-sandbox ./scripts/redrive-embed-dlq.sh sandbox
   ```

   For each message, the script async-invokes the embed Lambda with
   `{recipeId, userId, source: "redrive"}` and then deletes the message. Because only the
   keys are sent, the vector is built from the recipe's **current** text, not from text
   captured at the time of failure. A message with no `recipeId` or `userId` is skipped
   and left in the queue for manual inspection.
3. Watch the logs for `embed:done` with `source: "redrive"`. A recipe that fails again
   goes back to the DLQ a few minutes later, which raises the alarm again. The alarm
   returns to OK once the queue stays empty.

SQS's built-in "Start DLQ redrive" (`start-message-move-task`) does **not** work here,
because it moves messages back to a source queue and this DLQ is a Lambda destination with
no source queue. Use the script instead.

If a message is no longer needed (for example, the recipe has since been deleted), purge
the queue from the console or with `aws sqs purge-queue`. Recipes that are still missing a
vector can be picked up later with `scripts/backfill-embeddings.sh`.
