import { defineReplyHandler } from '../../../../../../../src/public/parts/shells/chat/src/reply/defineReplyHandler.mjs'
import { defineReplyPreviews } from '../../../../../../../src/public/parts/shells/chat/src/streaming/index.mjs'

const recommendCommandHandler = defineReplyHandler({
	tag: 'recommend-command',
	handle: async (reply, args, call) => {
		const command = call.inner.trim()
		if (!command) return {}
		reply.extension ??= {}
		reply.extension.recommend_command = reply.recommend_command = command
		return { content: reply.content.replace(/\s*<recommend-command>[\S\s]*?<\/recommend-command>\s*/g, '\n').trim() }
	},
})

/**
 * 推荐命令插件API类型定义
 * @type {import('../../../../../../../src/decl/pluginAPI.ts').pluginAPI_t}
 */
export const recommend_command_plugin = {
	info: {
		'zh-CN': {
			name: 'shell推荐命令插件',
			description: '推荐命令插件，让AI能够在shell环境中推荐命令',
			author: '',
		},
		'en-US': {
			name: 'shell recommend command plugin',
			description: 'recommend command plugin, let AI recommend commands in shell environment',
			author: '',
		},
	},
	interfaces: {
		chat: {
			/**
			 * 获取推荐命令的 Prompt。
			 * @param {object} args - 参数对象，包含 UserCharname。
			 * @param {object} result - 结果对象。
			 * @returns {object} - 包含 additional_chat_log 的对象。
			 */
			GetPrompt: async (args, result) => {
				return {
					additional_chat_log: [
						{
							role: 'system',
							name: 'system',
							content: `\
你可以通过回复以下格式来推荐命令让${args.UserCharname}选择是否执行：
<recommend-command>
command_body
</recommend-command>
`,
						}
					]
				}
			},
			GetReplyPreviewUpdater: defineReplyPreviews([recommendCommandHandler]),
			/**
			 * 处理回复，提取推荐命令。
			 * @param {object} result - 结果对象。
			 * @returns {boolean} - 返回 false 表示此处理器只修改结果，不完全处理回复。
			 */
			ReplyHandler: recommendCommandHandler
		}
	}
}
