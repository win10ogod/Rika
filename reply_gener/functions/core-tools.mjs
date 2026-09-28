import { Buffer } from 'node:buffer'

import { async_eval } from 'npm:@steve02081504/async-eval'

import {
	JS_DEFAULT_TIMEOUT_MS,
	parseRunLimits,
	runJsWithTimeout,
} from '../../../../../../../src/scripts/shell_guard.mjs'
import {
	defineReplyHandler,
	defineReplyHandlers,
	flattenReplyHandlers,
} from '../../../../../../../src/public/parts/shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../../../../../../src/public/parts/shells/chat/src/streaming/index.mjs'
import codeExecutionPlugin from '../../../../../../../src/public/parts/plugins/code-execution/main.mjs'
import fileOperationsPlugin from '../../../../../../../src/public/parts/plugins/file-operations/main.mjs'
import { resolveTarget } from '../../../../../../../src/public/parts/plugins/file-operations/src/target.mjs'
import { unlockAchievement } from '../../scripts/achievements.mjs'
import { statisticDatas } from '../../scripts/statistics.mjs'
import { captureScreen, sleep } from '../../scripts/tools.mjs'

import { fountApiContext } from './fount-api.mjs'

/** 本輪最近一次同步 code run 的工具日誌，供後接的 wait-screen 附加截圖。 */
const waitScreenTargets = new WeakMap()

/**
 * 在共用工具成功處理呼叫後，保留角色既有行為（成就、統計及 inline 正文替換）。
 * @param {import('../../../../../../../src/decl/pluginAPI.ts').ReplyHandler_t} replyHandler 共用工具 handler。
 * @param {(handler: object, reply: object, args: object, call: object|null, outcome: object) => Promise<object|void>} onHandled 成功處理後回呼。
 * @returns {import('../../../../../../../src/decl/pluginAPI.ts').ReplyHandler_t} 包裝後的 handler。
 */
function instrumentReplyHandler(replyHandler, onHandled) {
	return defineReplyHandlers(flattenReplyHandlers(replyHandler).map(handler => ({
		...handler,
		/**
		 * 執行原 handler，成功後才記錄角色行為。
		 * @param {object} reply 回覆物件。
		 * @param {object} args 請求參數。
		 * @param {object|null} call 工具呼叫。
		 * @returns {Promise<object>} handler 結果。
		 */
		handle: async (reply, args, call) => {
			const outcome = await handler.handle(reply, args, call) ?? {}
			return await onHandled(handler, reply, args, call, outcome) ?? outcome
		},
	})))
}

const fileOperationsReplyHandler = instrumentReplyHandler(
	fileOperationsPlugin.interfaces.chat.ReplyHandler,
	async () => {
		unlockAchievement('use_file_change').catch(console.error)
		statisticDatas.toolUsage.fileOperations++
	},
)

/**
 * 共用插件的本機 inline-js 預設不帶 workspace；角色既有契約需要共享 workspace 與 chat_log。
 * 遠端呼叫仍交回共用 evaluator，以保留 subfount 路由。
 * @param {object} handler inline-js handler。
 * @returns {object} 套用角色 context 的 handler。
 */
function adaptInlineJsContext(handler) {
	if (handler.name !== 'inline-js') return handler
	const sharedEvaluate = handler.evaluate
	return {
		...handler,
		/**
		 * @param {object} call 工具呼叫。
		 * @param {object} args 請求參數。
		 * @returns {Promise<string>} inline 結果。
		 */
		evaluate: async (call, args) => {
			if (resolveTarget(args, call.params).remote) return sharedEvaluate(call, args)
			args.chat_scoped_char_memory ??= {}
			const workspace = args.chat_scoped_char_memory.coderunner_workspace ??= {}
			const limits = parseRunLimits(call.params, JS_DEFAULT_TIMEOUT_MS)
			const { evalResult, timedOut } = await runJsWithTimeout(
				() => async_eval(call.inner, { workspace, chat_log: args.chat_log }),
				limits.timeoutMs,
			)
			if (timedOut) throw new Error('內聯 JS 執行逾時；JS 無法強制終止，程式可能仍在執行。')
			if (evalResult?.error) throw evalResult.error
			return String(evalResult?.result)
		},
	}
}

const contextualCodeReplyHandler = defineReplyHandlers(
	flattenReplyHandlers(codeExecutionPlugin.interfaces.chat.ReplyHandler).map(adaptInlineJsContext),
)

const instrumentedCodeHandlers = flattenReplyHandlers(instrumentReplyHandler(
	contextualCodeReplyHandler,
	async (handler, reply, args, call, outcome) => {
		unlockAchievement('use_coderunner').catch(console.error)
		if (handler.name.startsWith('run-')) {
			statisticDatas.toolUsage.codeRuns++
			const toolEntry = [...reply.logContextBefore].reverse().find(entry => entry.name === `code-execution.${handler.name}`)
			if (toolEntry) waitScreenTargets.set(reply, toolEntry)
		}

		// 理華／理月既有 API 會把 inline 結果寫回 content；保留此契約，
		// 同時仍由共用管線的 evaluate cache 確保串流與終態只執行一次。
		if (handler.evaluate && call && !call.error && !outcome.regen) {
			const content = String(reply.content ?? '')
			return {
				...outcome,
				content: content.slice(0, call.start) + String(call.value) + content.slice(call.end),
			}
		}
	},
))

/** 每次 handler 管線開始時清除上一輪 wait-screen 目標。 */
const resetWaitScreenTarget = defineReplyHandler({
	name: 'character.wait-screen.reset',
	phase: 'before',
	handle: async reply => {
		waitScreenTargets.delete(reply)
		return {}
	},
})

/** 保留角色原有「執行後等待並截圖」能力。 */
const waitScreenReplyHandler = defineReplyHandler({
	tag: 'wait-screen',
	/**
	 * 將截圖附加到緊鄰之前的同步 code run 工具日誌。
	 * @param {object} reply 回覆物件。
	 * @param {object} _args 請求參數。
	 * @param {object} call 工具呼叫。
	 * @returns {Promise<object>} handler 結果。
	 */
	handle: async (reply, _args, call) => {
		const target = waitScreenTargets.get(reply)
		if (!target) return {}
		const seconds = Math.max(0, Number.parseFloat(call.inner.trim() || '0') || 0)
		await sleep(seconds * 1000)
		let screenshot
		try {
			screenshot = { name: 'screenshot.png', buffer: await captureScreen(), mime_type: 'image/png' }
		}
		catch (error) {
			console.error(error)
			screenshot = { name: 'error.log', buffer: Buffer.from(`Error: ${error.stack || error}`), mime_type: 'text/plain' }
		}
		target.files ??= []
		target.files.push(screenshot)
		return { regen: true }
	},
})

/** 共用 code-execution handlers，加上角色原有 wait-screen。 */
export const coreCodeReplyHandler = defineReplyHandlers([
	resetWaitScreenTarget,
	...instrumentedCodeHandlers,
	waitScreenReplyHandler,
])

/**
 * 角色內建檔案工具：執行與預覽直接復用 fount 共用插件，提示仍由角色動態決定是否注入。
 */
const builtInFileOperationsPlugin = {
	...fileOperationsPlugin,
	interfaces: {
		...fileOperationsPlugin.interfaces,
		chat: {
			...fileOperationsPlugin.interfaces.chat,
			GetPrompt: undefined,
			ReplyHandler: fileOperationsReplyHandler,
		},
	},
}

/**
 * 角色內建程式執行工具：共用 fount 的 timeout、輸出護欄、串流與遠端執行實作。
 */
const builtInCodeExecutionPlugin = {
	...codeExecutionPlugin,
	interfaces: {
		...codeExecutionPlugin.interfaces,
		chat: {
			...codeExecutionPlugin.interfaces.chat,
			GetPrompt: undefined,
			ReplyHandler: coreCodeReplyHandler,
			GetReplyPreviewUpdater: next => defineReplyPreviews(coreCodeReplyHandler)(next),
		},
	},
}

/** 不受使用者插件清單影響的角色核心工具。 */
export const coreToolPlugins = {
	'file-operations': builtInFileOperationsPlugin,
	'code-execution': builtInCodeExecutionPlugin,
	'character-fount-api': {
		interfaces: {
			code_execution: { GetJSCodeContext: fountApiContext },
		},
	},
}
