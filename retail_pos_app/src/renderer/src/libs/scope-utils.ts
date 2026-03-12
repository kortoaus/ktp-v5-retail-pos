export default function hasScope(
  userScopes: string[],
  requiredScopes: string[],
) {
  console.log("userScopes", userScopes);
  if (userScopes.includes("admin")) {
    return true;
  }

  //   userScopes must contain all required scopes
  return requiredScopes.every((scope) => userScopes.includes(scope));
}
