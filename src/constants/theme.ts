export const Colors={
  // Light: warm off-white base + mint-tinted panels (study-friendly, soft).
  light:{
    text:'#14202B',
    background:'#F7F8F6',
    backgroundElement:'#E8EFEC',
    backgroundSelected:'#D7E7E0',
    textSecondary:'#61706A',
  },
  // Dark: NEUTRAL blue-gray ramp (no green cast — the old #243A35 panels
  // clashed with the #14202B blue base and their luminance gap was too
  // small, so grid layers mushed together). Elevation ladder:
  //   background #10151B → element #1D252E → selected #2B3642
  // Each step ≈ +10% luminance, which is what makes cards/headers/timetable
  // columns read as separate layers instead of one dark smear.
  dark:{
    text:'#ECF1F5',
    background:'#10151B',
    backgroundElement:'#1D252E',
    backgroundSelected:'#2B3642',
    textSecondary:'#98A6B3',
  },
} as const;
/** Hairline opacity suffixes per scheme. Light keeps the existing faint
 * lines; dark needs ~2× the alpha for the 0.5px grid to stay visible on
 * the darker base. Read as hex-alpha suffixes appended to theme colors. */
export const GridLineAlpha={
  light:{ line:'22', lineSoft:'15', border:'33' },
  dark:{ line:'38', lineSoft:'2A', border:'4D' },
} as const;
export const Spacing={one:4,two:8,three:16,four:24,five:32,six:64};
export const MaxContentWidth=1000;
