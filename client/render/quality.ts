export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  readonly level: QualityLevel;
  /** Upper limit on device pixels per CSS pixel. */
  readonly maxPixelRatio: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Multiplier on the number of decorative plants and rocks. */
  readonly vegetationDensity: number;
  /** Bloom post-processing (with multisampling). */
  readonly bloom: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    level: 'low',
    maxPixelRatio: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 512,
    vegetationDensity: 0.5,
    bloom: false,
  },
  medium: {
    level: 'medium',
    maxPixelRatio: 1.5,
    antialias: false,
    shadows: true,
    shadowMapSize: 1024,
    vegetationDensity: 0.75,
    bloom: false,
  },
  high: {
    level: 'high',
    maxPixelRatio: 2,
    antialias: true,
    shadows: true,
    shadowMapSize: 2048,
    vegetationDensity: 1,
    bloom: true,
  },
};

function isQualityLevel(value: string | null): value is QualityLevel {
  return value === 'low' || value === 'medium' || value === 'high';
}

/**
 * Pick the graphics preset: a `?quality=low|medium|high` URL parameter wins, phones and
 * tablets (touch-first devices) get medium, everything else gets high.
 */
export function chooseQuality(search: string, touchFirst: boolean): QualitySettings {
  const requested = new URLSearchParams(search).get('quality');
  if (isQualityLevel(requested)) return QUALITY_PRESETS[requested];
  return QUALITY_PRESETS[touchFirst ? 'medium' : 'high'];
}
