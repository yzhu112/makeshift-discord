import CONFIG from '#config';

export function validateSignupReq(username, pwd, inviteCode) {
  if (
    typeof username !== 'string' ||
    typeof pwd !== 'string' ||
    typeof inviteCode !== 'string'
  )
    return { status: 400, msg: 'Invalid request' };
  if (!username.match(/^[a-zA-Z0-9_]{1,32}$/))
    return { status: 400, msg: 'Invalid username' };
  if (pwd.length < 8 || pwd.length > 128)
    return { status: 400, msg: 'Invalid password' };
  if (inviteCode !== CONFIG.SIGNUP_SECRET)
    return { status: 401, msg: 'Invalid invite code' };
  return { status: 200, msg: 'OK' };
}

export function validateLoginReq(username, pwd) {
  if (
    typeof username !== 'string' ||
    typeof pwd !== 'string'
  )
    return { status: 400, msg: 'Invalid request' };
  if (pwd.length < 8 || pwd.length > 128)
    return { status: 400, msg: 'Invalid password' };
  return { status: 200, msg: 'OK' };
}
