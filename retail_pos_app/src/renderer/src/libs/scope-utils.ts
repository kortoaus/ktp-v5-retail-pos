export default function hasScope(
  userScopes: string[],
  requiredScopes: string[],
) {
  if (userScopes.includes("admin")) {
    return true;
  }

  //   userScopes must contain all required scopes
  return requiredScopes.every((scope) => userScopes.includes(scope));
}
