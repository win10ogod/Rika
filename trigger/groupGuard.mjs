import { getChatClient } from '../../../../../../src/public/parts/shells/chat/src/api/client/index.mjs'
import { localhostLocales } from '../../../../../../src/scripts/i18n/bare.mjs'
import { loadAnyPreferredDefaultPart } from '../../../../../../src/server/parts_loader.mjs'
import { Rika, charname as BotCharname, username as FountUsername } from '../charbase.mjs'
import { fetchFilesForMessages } from '../reply_gener/utils.mjs'
import { sleep } from '../scripts/tools.mjs'

import { declaredOwnerEntityHash, operatorEntityHash, selfEntityHash } from './onMessage.mjs'

/** @type {number[]} */
let invalidGroupJoinEvents = []

/**
 * @returns {string} 目前可信的作者 entityHash
 */
function ownerEntityHash() {
	return declaredOwnerEntityHash || operatorEntityHash
}

/**
 * @param {object} group Group 鸭子类型
 * @returns {Promise<boolean>} 主人是否在群内
 */
async function checkOwnerPresence(group) {
	try {
		const { members } = await group.members()
		return members.some(member => String(member.entityHash || '').toLowerCase() === ownerEntityHash())
	}
	catch (error) {
		console.warn(`[Rika groupGuard] member list failed for ${group.id}, assuming owner present:`, error)
		return true
	}
}

/**
 * @param {object} event OnGroupEvent 事件
 * @param {object[]} channelHistoryForAI 频道历史
 * @returns {Promise<string>} 離群前的簡短說明
 */
async function generateDepartureMessage(event, channelHistoryForAI) {
	const groupNameForAI = event.group.name || `Group ${event.group.groupId}`
	let memory = {}
	try {
		const { getChatRequest } = await import('../../../../../../src/public/parts/shells/chat/src/chat/session/chatRequest.mjs')
		const request = await getChatRequest(
			event.group.groupId,
			BotCharname,
			event.channel.channelId || 'default',
			{ replicaUsername: FountUsername },
		)
		memory = request.chat_scoped_char_memory || {}
	}
	catch { /* 群元資料不可用時使用空白記憶 */ }
	const departureSystemPrompt = `你目前在「${groupNameForAI}」群組中，但可信身份資料顯示作者不在這裡。
用理華陰暗、克制而依戀作者的語氣留下一句簡短告別，然後系統會自動退出群組。
不要辱罵、威脅、情緒勒索或傷害任何人；只清楚表示「作者不在，所以你不留下」。
`
	const insultRequestContext = [
		...channelHistoryForAI,
		{
			name: 'system',
			role: 'system',
			time_stamp: Date.now(),
			content: departureSystemPrompt,
		},
	]

	const fountBotDisplayName = (await Rika.getPartInfo?.(localhostLocales[0]))?.name || BotCharname
	const insultRequest = {
		supported_functions: { markdown: true, files: false, add_message: false, mathjax: false, html: false, unsafe_html: false },
		username: FountUsername,
		chat_name: `${groupNameForAI}-invalid-group`,
		char_id: BotCharname,
		Charname: `${fountBotDisplayName}（理華自己）`,
		UserCharname: FountUsername,
		ReplyToCharname: '',
		locales: localhostLocales,
		time: new Date(),
		world: await loadAnyPreferredDefaultPart(FountUsername, 'worlds'),
		user: await loadAnyPreferredDefaultPart(FountUsername, 'personas'),
		char: Rika,
		other_chars: [],
		plugins: {},
		chat_scoped_char_memory: memory,
		chat_log: await fetchFilesForMessages(insultRequestContext),
		extension: {
			bridge: event.group.bridge,
			groupId: event.group.groupId,
			channelId: event.channel.channelId,
		},
	}

	try {
		const aiInsultReply = await Rika.interfaces.chat.GetReply(insultRequest)
		if (aiInsultReply?.content) return aiInsultReply.content
	}
	catch (error) {
		console.error(`[Rika groupGuard] departure generation failed for ${event.group.groupId}:`, error)
	}
	return '作者不在這裡。……我先離開。'
}

/**
 * @param {object} client ChatClient
 * @param {object} event OnGroupEvent 事件
 * @param {string} inviteLink 邀请链接
 */
async function sendOwnerInviteNotifications(client, event, inviteLink) {
	if (!inviteLink) return
	const inviteMessage = `我被拉入了一個作者不在的群組，已依身份規則退出：\`${event.group.name}\`（ID：\`${event.group.groupId}\`）
邀請連結：${inviteLink}`

	if (ownerEntityHash()) {
		const dm = await client.openDm(ownerEntityHash())
		const channel = await dm.defaultChannel()
		await channel.send({ content: inviteMessage })
	}

	const groups = await client.groups()
	for (const group of groups) {
		if (group.id === event.group.groupId) continue
		const { members } = await group.members()
		if (!members.some(member => String(member.entityHash || '').toLowerCase() === ownerEntityHash())) continue
		const channel = await group.defaultChannel()
		await channel.send({ content: `@${FountUsername} ${inviteMessage}` })
	}
}

/**
 * @param {object} client ChatClient
 * @param {object} event OnGroupEvent 事件
 */
async function sendDepartureAndLeaveGroup(client, event) {
	const group = await client.group(event.group.groupId)
	const channel = await group.channel(event.channel.channelId || 'default')
	let channelHistoryForAI = []
	try {
		const messages = await channel.messages({ limit: 10 })
		channelHistoryForAI = messages.map(row => ({
			name: row.content?.displayName || 'user',
			role: 'user',
			content: typeof row.content === 'string' ? row.content : row.content?.content || '',
			time_stamp: row.time || Date.now(),
		}))
	}
	catch { /* history optional */ }

	const departureMessageContent = await generateDepartureMessage(event, channelHistoryForAI)
	if (departureMessageContent)
		await channel.send({ content: departureMessageContent })
	await group.leave()
}

/**
 * @param {object} client ChatClient
 * @param {object} event OnGroupEvent 事件
 */
async function handleOwnerNotInGroup(client, event) {
	const now = Date.now()
	const thirtyMinutesAgo = now - 30 * 60 * 1000
	invalidGroupJoinEvents = [...invalidGroupJoinEvents.filter(ts => ts >= thirtyMinutesAgo), now]

	if (invalidGroupJoinEvents.length > 3) {
		console.warn(`[Rika groupGuard] >3 invalid joins in 30m; leaving ${event.group.groupId} without a generated message`)
		await client.group(event.group.groupId).then(group => group.leave())
		return
	}

	let inviteLink = null
	try {
		const group = await client.group(event.group.groupId)
		inviteLink = await group.createInvite()
	}
	catch (error) {
		console.error(`[Rika groupGuard] invite link failed for ${event.group.groupId}:`, error)
	}

	await sendOwnerInviteNotifications(client, event, inviteLink)
	await sendDepartureAndLeaveGroup(client, event)
}

/**
 * @param {object} event OnGroupEvent 事件
 */
async function handleGroupOwnerCheck(event) {
	if (!selfEntityHash || !FountUsername) return
	if (event.group.kind === 'dm') return

	const client = await getChatClient(FountUsername, selfEntityHash)
	const group = await client.group(event.group.groupId)
	if (await checkOwnerPresence(group)) return
	await handleOwnerNotInGroup(client, event)
}

/**
 * @param {Parameters<NonNullable<import('../../../../../../src/decl/charAPI.ts').CharAPI_t['interfaces']['chat']['OnGroupEvent']>>[0]} event 群事件
 * @returns {Promise<void>}
 */
export async function OnGroupEvent(event) {
	if (event.type === 'member_left') {
		if (event.member?.entityHash?.toLowerCase() === ownerEntityHash()) {
			const client = await getChatClient(FountUsername, selfEntityHash)
			await client.group(event.group.groupId).then(group => group.leave())
		}
		return
	}

	if (event.type === 'bot_started' || event.type === 'bot_joined_group') {
		await sleep(event.type === 'bot_started' ? 0 : 500)
		await handleGroupOwnerCheck(event)
	}
}
