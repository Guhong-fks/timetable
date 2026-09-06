export const Colors={light:{text:'#14202B',background:'#F7F8F6',backgroundElement:'#E8EFEC',backgroundSelected:'#D7E7E0',textSecondary:'#61706A'},dark:{text:'#F7F8F6',background:'#14202B',backgroundElement:'#243A35',backgroundSelected:'#35534A',textSecondary:'#B4C5BE'}} as const;
export type ThemeColor=keyof typeof Colors.light;
export const Spacing={one:4,two:8,three:16,four:24,five:32,six:64};
export const MaxContentWidth=1000;
