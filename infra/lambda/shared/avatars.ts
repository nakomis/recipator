// Member avatars (RECP-51). Avatars live at a stable convention key in the
// recipator-avatars-{env} bucket — setting one is just uploading this object, so
// no SSM/config edit is needed. GET /config presigns a download URL per member;
// POST /config/avatar issues a presigned PUT for the caller's own avatar.

export const AVATAR_CONTENT_TYPE = 'image/jpeg';

/** S3 key for a member's avatar, e.g. avatars/<userId>.jpg. */
export const avatarKey = (userId: string) => `avatars/${userId}.jpg`;
