export type DebugFeatureSettings = {
	toolMetrics: boolean;
	modelInferenceMetrics: boolean;
};

export const DEFAULT_DEBUG_FEATURE_SETTINGS: DebugFeatureSettings = {
	toolMetrics: true,
	modelInferenceMetrics: true,
};
