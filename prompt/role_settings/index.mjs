import { mergePrompt } from '../build.mjs'

import { BasedefPrompt } from './base_defs.mjs'
import { ExpertisePrompt } from './expertise.mjs'
import { HistoryPrompt } from './history.mjs'

/**
 * 組合理華的核心人格與當次需要的專長規則。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 回覆請求。
 * @param {import('../logical_results/index.mjs').logical_results_t} logical_results 邏輯結果。
 * @returns {Promise<object>} 角色提示。
 */
export function RoleSettingsPrompt(args, logical_results) {
	return mergePrompt(
		BasedefPrompt(args, logical_results),
		HistoryPrompt(args, logical_results),
		ExpertisePrompt(args, logical_results)
	)
}
