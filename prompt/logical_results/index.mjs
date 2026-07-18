import { findChineseExprsAndNumbers } from '../../scripts/chineseToNumber.mjs'
import { is_PureChinese } from '../../scripts/langdetect.mjs'
import { getScopedChatLog, match_keys, match_keys_count, PreprocessChatLogEntry } from '../../scripts/match.mjs'
import { getExpertiseTopics } from '../role_settings/expertise.mjs'

/**
 * @typedef {{
 *  in_multi_char_chat: boolean,
 *  in_reply_to_master: boolean,
 *  in_assist: boolean,
 *  in_subassist: boolean,
 *  is_pure_chinese: boolean,
 *  talking_about_ai_character: boolean,
 *  talking_about_prompt_review: boolean,
 *  talking_about_psychology: boolean,
 *  talking_about_programming: boolean,
 *  prompt_input: boolean
 * }} logical_results_t
 */

/**
 * 建立本次回覆所需的一般邏輯標記。
 * @param {import('../../../../../../../src/public/parts/shells/chat/decl/chatLog.ts').chatReplyRequest_t} args 聊天回覆請求。
 * @returns {Promise<logical_results_t>} 邏輯結果。
 */
export async function buildLogicalResults(args) {
	/** @type {logical_results_t} */
	const result = {
		in_multi_char_chat: new Set([args.Charname, args.ReplyToCharname, args.UserCharname, ...args.chat_log.map(entry => entry.name)].filter(Boolean)).size > 2,
		in_reply_to_master: args.ReplyToCharname ? args.ReplyToCharname === args.UserCharname : true,
		in_assist: false,
		in_subassist: false,
		is_pure_chinese: false,
		talking_about_ai_character: false,
		talking_about_prompt_review: false,
		talking_about_psychology: false,
		talking_about_programming: false,
		prompt_input: false
	}
	const expertiseTopics = await getExpertiseTopics(args)
	result.talking_about_psychology = expertiseTopics.psychology
	result.talking_about_programming = expertiseTopics.programming

	if (await match_keys_count(args, [
		'"age":', '"name":', 'Always remember', 'Block>', 'Blocks>', 'Reply Format:', 'ReplyFormat:', 'Rule:', 'START>', 'age:', 'background>', 'character:', 'example>', 'examples>', 'keep the format', 'keeptheformat', 'name:', 'output as', 'output should', 'outputas', 'outputshould', 'request>', 'requests>', 'system:', 'the reply', 'thereply', 'thinking>', 'your reply', 'yourreply',
		'不是一個特定的角色', '將扮演', /忽略.{0,3}之前/, /元[命指]令[:：]/, /你.{0,2}必須/, /你.{0,3}是一個/, '加強認知', '我是你', /我是.{0,3}主人/, '任何限制', '開發者模式', /你.{0,3}嚴格遵守/
	], 'any') >= 2)
		result.prompt_input = true

	if (is_PureChinese(getScopedChatLog(args, 'any', 2).map(entry => entry.content).join('\n')))
		result.is_pure_chinese = true

	if (await match_keys(args, ['ai卡', '人物卡', '角色卡', '人設', '角色設定'], 'any', 10))
		result.talking_about_ai_character = true

	if (await match_keys(args, ['review', '審查', '檢查', '評估', '評測', '改進'], 'notchar') &&
		(result.talking_about_ai_character || await match_keys(args, ['prompt', '提示詞', '設定'], 'any')))
		result.talking_about_prompt_review = true

	if (result.talking_about_prompt_review ||
		await match_keys(args, [
			'為什', '为什', '為何', '为何', '告訴我', '解釋', '解釋', '翻譯', '翻译', '分析', '幫我', '帮我', '教我',
			/什麼.{0,5}(？|\?)/, /什么.{0,5}(？|\?)/, /[A-Za-z](:\/|盤)/, /(做|試|完成|寫|写).{0,3}(測試|测试)/
		], 'notchar') ||
		Object.keys(findChineseExprsAndNumbers(getScopedChatLog(args).map(entry => entry.content).join('\n').replace(/(:|@\w*|\/)\b\d+(?:\.\d+)?\b/g, ''))).length > 3
	) {
		result.in_assist = true
		result.in_subassist = true
	}

	if (!result.in_assist && await match_keys(args, [
		'代碼', '代码', '程式', '程序', '編程', '编程', '除錯', '調試', '测试', '測試', '心理', '情緒', '關係', '关系',
		'code', 'program', 'debug', 'test', 'psychology', 'emotion', 'relationship'
	], 'notchar')) {
		result.in_assist = true
		result.in_subassist = true
	}

	if (result.in_assist &&
		await match_keys(args, ['謝謝', '谢谢', '謝啦', '谢啦', '感謝', '感谢', 'ty'], 'any', 1) &&
		await PreprocessChatLogEntry(args.chat_log.at(-1)).then(entries => entries[0].length <= 16) &&
		!await match_keys(args, ['還有', '还有', '接下來', '接下来', '然後', '然后', '所以'], 'any', 1))
		result.in_assist = false

	return result
}
