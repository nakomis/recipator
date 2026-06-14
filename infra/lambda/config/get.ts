import { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { log } from '../shared/logger';

const ssm = new SSMClient({});
const GROUP_MEMBERS_PARAM = process.env.GROUP_MEMBERS_PARAM!;

let cached: string | undefined;

export async function handler(_event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> {
  const fromCache = cached !== undefined;
  if (!cached) {
    const res = await ssm.send(new GetParameterCommand({ Name: GROUP_MEMBERS_PARAM }));
    cached = res.Parameter!.Value!;
  }

  const groupMembers = JSON.parse(cached);
  log.info('config:get', { members: Array.isArray(groupMembers) ? groupMembers.length : 0, cached: fromCache });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupMembers }),
  };
}
