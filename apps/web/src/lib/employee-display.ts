export function getEmployeeDisplayName(employee: {
  nickname: string | null;
  legalName: string | null;
} | null | undefined): string | null {
  return employee?.nickname ?? employee?.legalName ?? null;
}
