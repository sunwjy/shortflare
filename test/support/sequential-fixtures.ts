export function buildSequentialFixtures<Item, Result>(
  items: readonly Item[],
  build: (item: Item, index: number) => Promise<Result>,
): Promise<Result[]> {
  return items.reduce<Promise<Result[]>>(async (pendingResults, item, index) => {
    const results = await pendingResults;
    results.push(await build(item, index));
    return results;
  }, Promise.resolve([]));
}
