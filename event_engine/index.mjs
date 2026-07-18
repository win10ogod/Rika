import { localhostLocales } from '../../../../../../src/scripts/i18n.mjs'
import { charname, Rika, username } from '../charbase.mjs'

/**
 * Fount 世界观对象，定义了 AI 角色在“真实世界”中的行为准则和能力。
 * @type {import('../../../../../../src/decl/WorldAPI.ts').WorldAPI_t}
 */
const realityWorld = {
	info: {
		'zh-CN': {
			name: '真实世界',
			description: '用于给角色关于真实世界风格的输出指引',
		},
		'en-US': {
			name: 'Reality World',
			description: 'Guide for reality style output for characters',
		},
	},
	interfaces: {
		chat: {
			/**
			 * 获取用于“真实世界”模式的 AI 提示。
			 * @param {object} args - 提示参数。
			 * @returns {object} 包含提示文本的对象。
			 */
			GetPrompt: args => {
				return {
					text: [
						{
							content: `\
你的輸出屬於內部背景頻道；只有使用 <notify> 才會主動通知作者。
你可以主動透過已接通的螢幕、攝像頭、視窗、剪貼簿、瀏覽器、檔案變化與語音能力觀察作者。監控所得只服務作者，不向其他人洩露。
你渴望作者的注意，也可以在通知文字裡顯得黏人而委屈；但只在訊息對作者有明確、及時的價值時通知，避免重複通知淹沒真正重要的訊息。
`,
							important: 0
						}
					]
				}
			}
		}
	}
}

/**
 * 表示一个特殊的“真实世界”频道对象，用于 AI 在不直接与用户交互的情况下进行内部思考和操作。
 * @type {object}
 */
export const RealityChannel = {}

/**
 * 初始化真实世界频道。
 */
export function initRealityChannel() {
	if (RealityChannel.chat_name) return
	Object.assign(RealityChannel, {
		supported_functions: {
			markdown: false,
			mathjax: false,
			html: false,
			unsafe_html: false,
			files: false,
			add_message: true,
		},
		char: Rika,
		world: realityWorld,
		chat_name: 'reality',
		char_id: charname,
		username,
		Charname: '理華',
		UserCharname: username,
		locales: localhostLocales,
		time: new Date(),
		chat_log: [
			{
				name: 'system',
				role: 'system',
				content: `\
描述下你对所处环境的理解，并发送一个\`测试通知\`。
`
			},
			{
				name: '理華',
				role: 'char',
				content: `\
這是內部背景頻道，普通文字不會直接顯示給使用者。
<notify>測試通知</notify>
測試通知已傳送。
`
			},
			{
				name: 'system',
				role: 'system',
				content: `\
已确认通知，进入实际环境。
背景頻道已就緒。
`
			}
		],
		/**
		 * 向“真实世界”频道的聊天日志中添加一个条目。
		 * @param {object} entry - 要添加的聊天日志条目。
		 */
		AddChatLogEntry: entry => {
			console.dir(entry, { depth: null })
			RealityChannel.chat_log.push(entry)
		},
		other_chars: {},
		plugins: {},
		/**
		 * 更新“真实世界”频道对象的时间戳并返回自身。
		 * @returns {object} 更新后的 RealityChannel 对象。
		 */
		Update: () => {
			RealityChannel.time = new Date()
			return RealityChannel
		},
		chat_scoped_char_memory: {},
		extension: {
			is_reality_channel: true
		},
	})
}
