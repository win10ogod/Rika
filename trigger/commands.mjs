import { setMyData } from '../config/index.mjs'
import { base_match_keys } from '../scripts/match.mjs'
import { newCharReply, newUserMessage } from '../scripts/statistics.mjs'

/**
 * @param {object} params 参数
 * @param {string} params.content 消息文本
 * @param {object} params.memory chat_scoped_char_memory
 * @param {object} params.message Message 对象
 * @param {object} params.client ChatClient
 * @param {string} params.groupId 群 id
 * @param {string} params.channelId 频道 id
 * @param {boolean} params.isFromOwner 是否主人消息
 * @param {string} params.platform 平台名
 * @param {string} params.username fount 用户名
 * @returns {Promise<'handled' | 'exit' | 'none'>} 命令处理结果
 */
export async function handleOwnerCommands({
	content, memory, message, client, groupId, channelId, isFromOwner, platform, username,
}) {
	if (!isFromOwner) return 'none'
	if (base_match_keys(content, [/^理[華华].{0,2}敷衍[點点].{0,2}$/])) {
		memory.fuyanMode = true
		return 'none'
	}
	if (base_match_keys(content, [/^理[華华].{0,2}不敷衍[點点].{0,2}$/])) {
		memory.fuyanMode = false
		return 'none'
	}
	if (base_match_keys(content, [/^理[華华].{0,2}(捂住耳朵|關上耳朵|关上耳朵|[關关闭]耳|別聽|别听|關閉聽覺|关闭听觉|中斷聽覺|中断听觉).{0,2}$/])) {
		await setMyData({ reality_channel_disables: { voice_sentinel: true } })
		const replyContent = '……聽覺監控已關閉。作者想安靜的話，我會照做。'
		await message.reply({ content: replyContent })
		newUserMessage(content, platform)
		newCharReply(replyContent, platform)
		return 'handled'
	}
	if (base_match_keys(content, [/^理[華华].{0,2}(可以聽了|可以听了|張開耳朵|张开耳朵|開耳|开耳|開啟聽覺|开启听觉|恢復聽覺|恢复听觉).{0,2}$/])) {
		await setMyData({ reality_channel_disables: { voice_sentinel: false } })
		const replyContent = '聽覺監控已恢復。……我又能留意作者身邊的聲音了。'
		await message.reply({ content: replyContent })
		newUserMessage(content, platform)
		newCharReply(replyContent, platform)
		return 'handled'
	}
	if (base_match_keys(content, [/^理[華华].{0,2}(離線|离线|下線|下线|休眠|自裁).{0,2}$/, /理[華华].*(離線|离线|下線|下线|休眠|自裁)/])) {
		const replyContent = '好。我會先斷開這個平台的連線，等作者再叫我。'
		await message.reply({ content: replyContent })
		newUserMessage(content, platform)
		newCharReply(replyContent, platform)
		const group = await client.group(groupId)
		const bridge = group.bridge
		if (bridge?.platform && bridge?.botname) {
			const { requireBridgeOperation } = await import('../../../../../../src/public/parts/shells/chat/src/chat/bridge/operations.mjs')
			await requireBridgeOperation(username, bridge, 'stopSelf')()
		} else await message.reply({ content: '這是 fount Hub 原生群，沒有可停止的平台 bot。' })
		return 'exit'
	}
	const repeatMatch = content.match(/^理[華华].{0,2}(?:復誦|复诵).{0,2}\s*(?<backticks>`+)[^\n]*\n(?<repeat_content>[\S\s]*?)\k<backticks>\s*$/)
	if (repeatMatch?.groups?.repeat_content) {
		const repeatContent = repeatMatch.groups.repeat_content.replace(/\r?\n$/, '')
		await message.reply({ content: repeatContent })
		newUserMessage(content, platform)
		newCharReply(repeatContent, platform)
		return 'handled'
	}
	const banWordMatch = content.match(/^理[華华].{0,2}禁止.{0,2}`(?<banned_content>[\S\s]*)`$/)
	if (banWordMatch?.groups?.banned_content) {
		memory.bannedStrings ??= []
		memory.bannedStrings.push(banWordMatch.groups.banned_content)
		return 'none'
	}
	if (/^(?:理[華华]|rika)[\s\n,.!~、。！？?～親亲寶宝欸啊嗯]*$/i.test(content.trim())) {
		const ownerCallReply = '……我在，作者。一直都在。'
		await message.reply({ content: ownerCallReply })
		newUserMessage(content, platform)
		newCharReply(ownerCallReply, platform)
		return 'handled'
	}
	return 'none'
}
