export {
  MAX_SECTION_PIECES,
  handlePoint,
  isSoftPiece,
  makeSection,
  naturalSection,
  neighbourLists,
  sectionBrief,
  sectionPolyline,
  slideCandidates,
  slideSectionEnd,
  type Section,
  type SectionBrief,
  type TrackChain,
} from './section'
export {
  BRANCH_SNAP_MM,
  branchAnchors,
  branchingPieces,
  insertIntoRun,
  pieceCore,
  swapPlacement,
  type BranchAnchor,
  type RunCore,
  type RunInsertion,
} from './branch'
export {
  bridgeOver,
  crossingPieces,
  findCrossings,
  levelCrossings,
  type CrossingSite,
  type LevelCrossing,
} from './crossing'
export {
  MIN_BRANCH_DRAWING_MM,
  distanceToTrack,
  extendTrack,
  newPieceIndices,
  type BranchOption,
  type ExtendOptions,
  type ExtendReason,
  type ExtendResult,
} from './extend'
export {
  MIN_SECTION_DRAWING_MM,
  availableInventory,
  replaceSection,
  splice,
  type ReplaceOptions,
  type ReplaceReason,
  type ReplaceResult,
} from './replace'
export { assembleTrack, type AssembleReason } from './assemble'
export { swapOptions, type SwapOption, type SwapOptions } from './swap'
export {
  fillGap,
  removeSection,
  type FillGapReason,
  type FillGapResult,
  type GapMarker,
  type RemoveOptions,
  type RemoveReason,
  type RemoveResult,
} from './remove'
export { solveSection, type SolveOption, type SolveOptions } from './solve'
export {
  bundledVariationSpecs,
  resolveVariation,
  type ResolvedVariation,
  type VariationSpec,
  type VariationStep,
} from './variations'
