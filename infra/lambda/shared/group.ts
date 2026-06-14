// Group-membership helper shared by the household ("all") read paths.
//
// Recipes are owned per-user, but group members share a household view. The
// group is configured out-of-band in SSM (`/recipator/{env}/group-members`,
// the same parameter GET /config serves) so membership can change without a
// deploy. Reading it here lets the API scope household views server-side rather
// than trusting the client to filter — so a non-member's recipes (e.g. the App
// Store review account) never leak into a household view, and vice versa.
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});
const GROUP_MEMBERS_PARAM = process.env.GROUP_MEMBERS_PARAM;

interface GroupMember { userId: string; displayName?: string }

// Cached for the container's lifetime — membership changes are rare and a
// container recycles soon enough. Mirrors the GET /config handler's approach.
let cached: GroupMember[] | undefined;

async function loadMembers(): Promise<GroupMember[]> {
  if (cached) return cached;
  if (!GROUP_MEMBERS_PARAM) return (cached = []);
  const res = await ssm.send(new GetParameterCommand({ Name: GROUP_MEMBERS_PARAM }));
  return (cached = JSON.parse(res.Parameter?.Value ?? '[]') as GroupMember[]);
}

/**
 * The set of owner userIds whose recipes `callerId` may see in household ("all")
 * mode. A group member sees every group member's recipes; a non-member sees only
 * their own.
 */
export async function visibleOwnerIds(callerId: string): Promise<Set<string>> {
  const memberIds = (await loadMembers()).map(m => m.userId);
  return memberIds.includes(callerId) ? new Set(memberIds) : new Set([callerId]);
}
