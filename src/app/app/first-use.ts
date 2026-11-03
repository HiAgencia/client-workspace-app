


export function isFirstUse(read: { tree: unknown[] | null; generalTasks: number | null; notePlaces: { general: boolean } | null }): boolean {
  return read.tree !== null && read.tree.length === 0 && read.generalTasks === 0 && read.notePlaces?.general !== true;
}
