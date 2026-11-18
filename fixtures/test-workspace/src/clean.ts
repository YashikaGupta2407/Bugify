// Perfectly clean TypeScript file with no diagnostics
export function calculateTotal(items: number[]): number {
  return items.reduce((sum, current) => sum + current, 0);
}
