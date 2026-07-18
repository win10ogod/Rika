import { FunctionPrompt } from './functions/index.mjs'
import { MemoriesPrompt } from './memory/index.mjs'
import { RoleSettingsPrompt } from './role_settings/index.mjs'
import { SubAgentWorkerPrompt } from './sub_agent.mjs'
import { CoreRulesPrompt } from './system/corerules.mjs'
import { SystemPrompt } from './system/index.mjs'

/**
 * 合并多个 Prompt 对象。
 * @param {...object} prompts - 多个 Prompt 对象。
 * @returns {Promise<object>} - 合并后的 Prompt 对象。
 */
export async function mergePrompt(...prompts) {
	prompts = await Promise.all(prompts.filter(Boolean))
	const result = {
		text: [],
		additional_chat_log: [],
		extension: {}
	}
	for (const prompt of prompts) {
		result.text = result.text.concat(prompt.text || [])
		result.additional_chat_log = result.additional_chat_log.concat(prompt.additional_chat_log || [])
		result.extension = Object.assign(result.extension, prompt.extension)
	}
	result.text = result.text.filter(text => text.content)
	result.additional_chat_log = result.additional_chat_log.filter(chat_log => chat_log.content)
	return result
}

/**
 * 构建最终的 Prompt。
 * @param {import("../../../../../../src/public/parts/shells/chat/decl/chatLog.ts").chatReplyRequest_t} args - 聊天回复请求参数。
 * @param {import("./logical_results/index.mjs").logical_results_t} logical_results - 逻辑结果。
 * @returns {Promise<object>} - 构建后的 Prompt 对象。
 */
export async function buildPrompt(args, logical_results) {
	return mergePrompt(
		MemoriesPrompt(args, logical_results),
		RoleSettingsPrompt(args, logical_results),
		await FunctionPrompt(args, logical_results), // await 因为函数提示词可能修改enable_prompts而向SystemPrompt传递音频或图片的包含信息
		SystemPrompt(args, logical_results)
	)
}

/**
 * 建立子代理專用提示：保留完整工具能力，不注入理華的角色扮演與私人記憶。
 * @param {import("../../../../../../src/public/parts/shells/chat/decl/chatLog.ts").chatReplyRequest_t} args 回覆請求。
 * @param {import("./logical_results/index.mjs").logical_results_t} logical_results 邏輯結果。
 * @returns {Promise<object>} 子代理提示。
 */
export async function buildSubAgentPrompt(args, logical_results) {
	return mergePrompt(
		SubAgentWorkerPrompt(args),
		await FunctionPrompt(args, logical_results),
		CoreRulesPrompt(args, logical_results)
	)
}
