/** @typedef {import('../../../../../../../src/decl/AIsource.ts').AIsource_t} AIsource_t */

import { mergeStructPromptChatLog } from '../../../../../../../src/public/parts/shells/chat/src/prompt_struct/index.mjs'
import { getConfiguredAISource } from '../../AISource/index.mjs'
import { unlockAchievement } from '../../scripts/achievements.mjs'
import { statisticDatas } from '../../scripts/statistics.mjs'
import { parseSubAgentCalls } from '../../scripts/sub-agent.mjs'
import { baseGetReply } from '../index.mjs'

/**
 * 複製聊天記錄結構，同時保留檔案 Buffer 參照，避免子代理修改主對話的記錄物件。
 * @param {object} entry 聊天記錄條目。
 * @returns {object} 複製後條目。
 */
function cloneChatLogEntry(entry) {
	return {
		...entry,
		extension: entry.extension ? { ...entry.extension } : entry.extension,
		files: entry.files?.map(file => ({ ...file })) || [],
		logContextBefore: entry.logContextBefore?.map(cloneChatLogEntry),
		logContextAfter: entry.logContextAfter?.map(cloneChatLogEntry),
	}
}

/**
 * 建立隔離的子代理回覆請求。完整父對話會被複製；工作記憶、時間線與串流快取不共享。
 * @param {object} args 主代理回覆請求。
 * @param {ReturnType<parseSubAgentCalls>[number]} call 子代理呼叫。
 * @param {AIsource_t} source 選定的 AI 來源。
 * @param {object[]} parentChatLog 分派前的完整父對話快照。
 * @returns {object} 子代理回覆請求。
 */
function buildSubAgentArgs(args, call, source, parentChatLog) {
	const childGenerationOptions = { ...args.generation_options }
	delete childGenerationOptions.base_result
	delete childGenerationOptions.replyPreviewUpdater

	const childExtension = { ...args.extension }
	delete childExtension.logical_results
	delete childExtension.streamInlineToolsResults
	delete childExtension.ai_source_override
	Object.assign(childExtension, {
		is_sub_agent: true,
		is_internal: true,
		source_purpose: 'sub-agent',
		ai_source_override: source,
		sub_agent: {
			name: call.name,
			task: call.task,
			context: call.context,
			requested_model: call.requestedModel,
			model_mode: call.modelSpecified ? 'dedicated' : 'main'
		}
	})

	const taskMessage = `
理華交付給子代理「${call.name}」的工作如下：
<task>
${call.task}
</task>
${call.context ? `<context>\n${call.context}\n</context>` : ''}

完成工作後，只輸出交給理華的最終內部報告。
`

	return {
		...args,
		ReplyToCharname: args.UserCharname,
		chat_name: `${args.chat_name || 'chat'}/sub-agent/${call.name}`,
		chat_log: [
			...parentChatLog.map(cloneChatLogEntry),
			{ name: 'sub-agent-task', role: 'system', content: taskMessage, files: [] }
		],
		timelines: [],
		plugins: {},
		chat_scoped_char_memory: {},
		extension: childExtension,
		generation_options: childGenerationOptions,
		supported_functions: {
			...args.supported_functions,
			add_message: false
		}
	}
}

/**
 * 執行單一子代理工作。指定 model 時只使用專用來源；未指定時復用主來源。
 * @param {ReturnType<parseSubAgentCalls>[number]} call 子代理工作。
 * @param {object} args 主代理 handler 參數。
 * @param {object[]} parentChatLog 分派前的完整父對話快照。
 * @returns {Promise<object>} 執行結果與可觀測路由資訊。
 */
async function runSubAgent(call, args, parentChatLog) {
	const startedAt = Date.now()
	const sourceMode = call.modelSpecified ? 'dedicated' : 'main'
	try {
		if (!call.task)
			throw new Error('子代理任務為空；請在 <task> 中提供明確工作。')

		const source = call.modelSpecified
			? getConfiguredAISource('sub-agent')
			: args.main_AIsource
		if (!source)
			throw new Error(call.modelSpecified
				? '已指定子代理模型，但 AIsources.sub-agent 尚未配置；嚴格路由未執行 fallback。'
				: '無法取得產生主回覆的 AI 來源，未啟動子代理。')

		const childResult = await baseGetReply(buildSubAgentArgs(args, call, source, parentChatLog))
		if (!childResult)
			throw new Error('子代理沒有回傳可用結果。')

		return {
			call,
			ok: true,
			sourceMode,
			content: childResult.content,
			files: childResult.files || [],
			extension: childResult.extension || {},
			durationMs: Date.now() - startedAt
		}
	}
	catch (error) {
		return {
			call,
			ok: false,
			sourceMode,
			content: error?.message || String(error),
			files: [],
			extension: {},
			durationMs: Date.now() - startedAt
		}
	}
}

/**
 * 執行主模型輸出的所有子代理分派。多個獨立工作以 Promise.all 並行執行。
 * @type {import('../../../../../../../src/decl/PluginAPI.ts').ReplyHandler_t}
 */
export async function subAgentHandler(result, args) {
	if (args.extension?.is_sub_agent) return false
	const calls = parseSubAgentCalls(result.content)
	if (!calls.length) return false
	const parentChatLog = mergeStructPromptChatLog(args.prompt_struct)

	args.AddLongTimeLog({
		name: '理華',
		role: 'char',
		content: calls.map(call => call.raw).join('\n'),
		files: []
	})

	statisticDatas.toolUsage.subAgentDelegations = (statisticDatas.toolUsage.subAgentDelegations || 0) + calls.length
	const outcomes = await Promise.all(calls.map(call => runSubAgent(call, args, parentChatLog)))
	result.extension.sub_agents = [
		...result.extension.sub_agents || [],
		...outcomes.map(outcome => ({
			name: outcome.call.name,
			ok: outcome.ok,
			model_mode: outcome.sourceMode,
			requested_model: outcome.call.requestedModel,
			duration_ms: outcome.durationMs,
			skills: outcome.extension.skills || []
		}))
	]

	for (const outcome of outcomes)
		args.AddLongTimeLog({
			name: `sub-agent:${outcome.call.name}`,
			role: 'tool',
			content: outcome.ok
				? `子代理「${outcome.call.name}」已完成（${outcome.sourceMode === 'dedicated' ? '專用模型' : '主模型'}）${outcome.extension.skills?.length ? `；已啟用 Skills：${outcome.extension.skills.join(', ')}` : ''}：\n${outcome.content}`
				: `子代理「${outcome.call.name}」失敗（${outcome.sourceMode === 'dedicated' ? '專用模型，無 fallback' : '主模型'}）：\n${outcome.content}`,
			files: outcome.files
		})

	if (outcomes.some(outcome => outcome.ok))
		await unlockAchievement('use_sub_agent')

	return true
}
