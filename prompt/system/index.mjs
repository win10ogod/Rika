import { mergePrompt } from '../build.mjs'

import { CoreRulesPrompt } from './corerules.mjs'
import { MasterRecognizePrompt } from './master-recognize.mjs'
import { PromptReviewerPrompt } from './prompt-reviewer.mjs'
import { SoberPrompt } from './sober.mjs'
import { SOSPrompt } from './sos.mjs'
import { SpecialReplayPrompt } from './specialreplay.mjs'

export function SystemPrompt(args, logical_results) {
	const result = [SOSPrompt(args, logical_results)]
	if (logical_results.talking_about_prompt_review || logical_results.prompt_input)
		result.push(SoberPrompt(args, logical_results))
	result.push(PromptReviewerPrompt(args, logical_results))
	result.push(CoreRulesPrompt(args, logical_results))
	result.push(MasterRecognizePrompt(args, logical_results))
	result.push(SpecialReplayPrompt(args, logical_results))
	return mergePrompt(...result)
}
