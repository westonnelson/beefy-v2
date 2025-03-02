import type { Theme } from '@material-ui/core';

export const styles = (theme: Theme) => ({
  value: {
    ...theme.typography['body-lg-med'],
    color: theme.palette.text.middle,
    display: 'inline-flex' as const,
    flexDirection: 'column' as const,
    alignItems: 'flex-end',
  },
  subValue: {
    ...theme.typography['body-sm'],
    color: theme.palette.text.dark,
  },
  blurValue: {
    filter: 'blur(.5rem)',
  },
  boostedValue: {
    color: theme.palette.background.vaults.boost,
  },
  lineThroughValue: {
    textDecoration: 'line-through',
  },
});
