export { beamFit, fitOptions, DEFAULT_TUNING, type BeamFit, type FitOption, type FitTuning, type GoalFrame } from './beam'
export { fitDrawing, type FitOptions, type FitReason, type FitResult } from './fit'
export {
  cleanDrawing,
  dropDenseSamples,
  polylineLength,
  resamplePolyline,
  simplifyRdp,
  DEFAULT_CLOSE_THRESHOLD_MM,
  DEFAULT_RDP_TOLERANCE_MM,
  MIN_DRAWING_LENGTH_MM,
  type CleanDrawing,
  type CleanOptions,
} from './simplify'
export { buildTarget, type Projection, type TargetPath } from './target'
