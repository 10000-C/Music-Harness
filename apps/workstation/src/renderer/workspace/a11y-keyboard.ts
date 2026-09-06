export type RovingTabKey = 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End';

export const getRovingTabIndex = (
  key: RovingTabKey,
  currentIndex: number,
  itemCount: number,
): number => {
  if (itemCount <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;

  const normalizedIndex =
    currentIndex >= 0 && currentIndex < itemCount ? currentIndex : 0;
  const offset = key === 'ArrowLeft' ? -1 : 1;
  return (normalizedIndex + offset + itemCount) % itemCount;
};

export const getTrappedTabIndex = (
  currentIndex: number,
  itemCount: number,
  backwards: boolean,
): number => {
  if (itemCount <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= itemCount) {
    return backwards ? itemCount - 1 : 0;
  }

  const offset = backwards ? -1 : 1;
  return (currentIndex + offset + itemCount) % itemCount;
};
