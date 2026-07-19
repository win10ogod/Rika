import { getTelegramBotForChar } from '../../../../../../../src/public/parts/shells/telegrambot/src/default_interface/main.mjs'
import { charname, username } from '../../charbase.mjs'
import { rude_words } from '../../scripts/dict.mjs'
import { match_keys } from '../../scripts/match.mjs'

/**
 * 获取 Telegram API 插件。
 * @param {object | null | undefined} nativeContext fount bridge 水合出的原生上下文。
 * @returns {import('../../../../../../../src/decl/pluginAPI.ts').pluginAPI_t} 插件 API。
 */
export const get_telegram_api_plugin = nativeContext => ({
	info: {
		'zh-CN': {
			name: 'Telegram 插件',
			description: '使 AI 能够在 Telegram 群组中进行高级操作。',
			author: '',
		}
	},
	interfaces: {
		code_execution: {
			/**
			 * 获取用于生成 JS 代码的 Prompt。
			 * @param {object} args - 参数对象。
			 * @returns {string | undefined} - JS 代码 Prompt 字符串或 undefined。
			 */
			GetJSCodePrompt: async args => {
				if (
					await match_keys(args, rude_words, 'any', 6) ||
					await match_keys(args, [
						'身份组', '群', '频道', '设置', '服务器', 'ban', '踢了', '禁言',
						'管理', '操作', '权限', '置顶', '分区', '分组', '帖子', '表情', '贴纸',
						'修改', '封禁', '邀请', /生成{0,3}链接/, '话题', '投票', '动态', '匿名',
						'刪了', '删了', '刪掉', '删掉', 'tg', 'telegram', 'https://t.me/',
					], 'any', 3)
				) {
					if (nativeContext?.message) return `\
你可以使用以下变量来访问Telegram API:
message: 你正在回复的Telegram消息
chat: 发生回复的Telegram群组
telegram_client: 你的Telegraf Bot实例
你可以用它们来进行高级操作，比如禁言、踢人、ban人、设置身份组、设置权限等。
`
					if (getTelegramBotForChar(username, charname)) return `\
你可以使用以下变量来访问Telegram API:
telegram_client: 你的Telegraf Bot实例
你可以用它来进行高级操作，但因为不是在Telegram聊天中，所以没有message、chat等上下文变量。
`
				}
			},
			/**
			 * 获取 JS 代码执行的上下文。
			 * @param {object} args - 参数对象。
			 * @returns {object | undefined} - JS 代码上下文对象或 undefined。
			 */
			GetJSCodeContext: async () => {
				const telegram_client = getTelegramBotForChar(username, charname)
				if (nativeContext?.message)
					return {
						message: nativeContext.message,
						chat: nativeContext.chat,
						telegram_client,
					}
				if (telegram_client)
					return { telegram_client }
			}
		}
	}
})
