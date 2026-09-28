import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'npm:jszip'

import { recommend_command_plugin } from '../../interfaces/shellassist/recommend_command.mjs'
import { SkillsPrompt } from '../../prompt/functions/skills.mjs'
import { chardir } from '../../charbase.mjs'
import { addLongTermMemory, deleteLongTermMemory, formatLongTermMemoryContext, getLongTermMemoryByName, getRandomNLongTermMemories, updateLongTermMemory } from '../../prompt/memory/long-term-memory.mjs'
import { deleteShortTermMemory, getShortTermMemoryNum, saveShortTermMemory, saveShortTermMemoryAfterReply, ShortTermMemoryPrompt } from '../../prompt/memory/short-term/index.mjs'
import { calculateRelevance, explicitMemoryPeriods, temporalMemoryBonus } from '../../prompt/memory/short-term/scoring.mjs'
import { memoryMatchesDeletion } from '../../prompt/memory/short-term/storage.mjs'
import { mergeChatLogEntries, rowIsFromSelf } from '../../reply_gener/utils.mjs'
import { getScopedChatLog, isReplyToNonMaster, isUserSpeaker, SimplifyContent } from '../../scripts/match.mjs'
import { hasEncounteredGentianAphrodite, hasUserWithdrawnLoveFromRika } from '../../scripts/achievement-triggers.mjs'
import { discoverSkills, formatSkillsCatalog, readSkill, readSkillResource } from '../../scripts/skills.mjs'
import { parseSubAgentCalls } from '../../scripts/sub-agent.mjs'
import { handleOwnerCommands } from '../../trigger/commands.mjs'
import { detectMentionedWithoutAt, waitForOwnerTypingEnd } from '../../trigger/helpers.mjs'

/* global fountCharCI */
const CI = fountCharCI

await CI.test('noAI Fallback', async () => {
	await CI.char.interfaces.config.SetData({ AIsources: {} })
	await CI.runOutput()
})

await CI.test('Setup AI Source', async () => {
	await CI.char.interfaces.config.SetData({
		AIsources: { CI: 'CI', 'sub-agent': 'CI' },
		disable_idle_event: true
	})
})

CI.test('Request-level AI Source', async () => {
	let calls = 0
	const source = { filename: 'request-override', async StructCall() {
		calls++
		return { content: 'REQUEST_OVERRIDE_OK', files: [], extension: {} }
	} }
	const { reply } = await CI.runInput('請使用請求級模型', { ai_source: source })
	CI.assert(reply?.content === 'REQUEST_OVERRIDE_OK' && calls === 1, 'args.ai_source did not use the requested source')
})

CI.test('Reply Lifecycle Hooks and Round Context', async () => {
	let beforeCalls = 0
	const prefetched = await CI.runOutput('BEFORE_REPLY_OK', {
		plugins: { prefetch: { interfaces: { chat: { BeforeReply: async ({ AddLongTimeLog }) => {
			beforeCalls++
			AddLongTimeLog({ name: 'prefetch', role: 'tool', content: 'BEFORE_REPLY_TOKEN' })
		} } } } },
	})
	CI.assert(beforeCalls === 1 && prefetched.logContextBefore.some(row => row.content === 'BEFORE_REPLY_TOKEN'), 'BeforeReply plugin was not invoked')
	let finishedRounds = 0
	const result = await CI.runOutput([
		'<activate-skill>software-engineering</activate-skill>',
		prompt => {
			CI.assert(prompt.prompt_single.includes('ROUND_WAKE_TOKEN'), 'new chat event was not injected before regeneration')
			return 'ROUND_WAKE_OK'
		},
	], {
		Update: async () => ({ chat_log: [{ id: 'ci-round-wake', name: 'CI-user', uid: 'ci-user', role: 'user', content: 'ROUND_WAKE_TOKEN', files: [] }] }),
		generation_options: { finishRound: async () => { finishedRounds++; return true } },
	})
	CI.assert(result?.content === 'ROUND_WAKE_OK' && finishedRounds === 1, 'round completion hook or regeneration failed')
})

CI.test('No Legacy Translation Dependency', async () => {
	CI.assert(!Object.hasOwn(CI.char.interfaces.config.GetData(), 'translateSource'), 'character still loads a translation source')
	const english = await SimplifyContent('Use the software engineering Skill')
	CI.assert(english[0] === 'Use the software engineering Skill' && english.every(text => !text.includes('软件工程')), 'English matching must not invoke translation')
	CI.assert((await SimplifyContent('測試')).includes('测试'), 'local traditional-to-simplified normalization must remain available')
})

CI.test('Together Shell Contracts', async () => {
	for (const interfaceName of ['telegram', 'discord', 'shellassist', 'browserIntegration', 'timers'])
		CI.assert(!!CI.char.interfaces[interfaceName], `character interface is missing: ${interfaceName}`)
	for (const methodName of ['OnMessage', 'OnGroupEvent'])
		CI.assert(typeof CI.char.interfaces.chat[methodName] === 'function', `together chat method is missing: ${methodName}`)
	CI.assert(typeof CI.char.OnError === 'function', 'together top-level OnError is missing')
	CI.assert(typeof CI.char.interfaces.telegram.stickers === 'object', 'Telegram sticker contract is missing')
	CI.assert(typeof CI.char.interfaces.discord.stickers === 'object', 'Discord sticker contract is missing')
	CI.assert(!Object.hasOwn(CI.char.interfaces.telegram, 'BotSetup'), 'character must let the together Telegram shell inject its connector')
	CI.assert(!Object.hasOwn(CI.char.interfaces.discord, 'OnceClientReady'), 'character must let the together Discord shell inject its connector')
	const platformInterfaces = Object.keys(CI.char.interfaces)
		.filter(name => /^(telegram|telegrambot|discord|discordbot)$/i.test(name))
	CI.assert(platformInterfaces.join(',') === 'telegram,discord', `duplicate platform interfaces would create duplicate configuration icons: ${platformInterfaces.join(',')}`)

	const fountConfig = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'fount.json'), 'utf8'))
	CI.assert(fountConfig.dirname === 'Rika', `character technical ID must remain Rika: ${fountConfig.dirname}`)
	CI.assert(encodeURIComponent(fountConfig.dirname) === fountConfig.dirname, `character technical ID must be URL-safe: ${fountConfig.dirname}`)
	for (const registry of ['locales', 'achievements'])
		CI.assert(Array.isArray(fountConfig.registries?.[registry]), `fount registry is missing: ${registry}`)
	const charRoot = path.join(import.meta.dirname, '..', '..')
	for (const legacyConnector of ['interfaces/telegram/index.mjs', 'interfaces/discord/index.mjs'])
		CI.assert(!fs.existsSync(path.join(charRoot, legacyConnector)), `legacy character connector must not shadow the together shell: ${legacyConnector}`)
	const achievementsSource = fs.readFileSync(path.join(charRoot, 'scripts', 'achievements.mjs'), 'utf8')
	CI.assert(!/onPartInstalled|registerAchievements/.test(achievementsSource), 'character load must not repeat the part-install lifecycle')
	const groupGuardSource = fs.readFileSync(path.join(charRoot, 'trigger', 'groupGuard.mjs'), 'utf8')
	CI.assert(!/world:\s*null/.test(groupGuardSource), 'latest together prompt requests require a world part')

	CI.assert(detectMentionedWithoutAt('理華，我需要你'), 'traditional Chinese name mention was not detected')
	CI.assert(detectMentionedWithoutAt('rika, help me'), 'English name mention was not detected')
	const replies = []
	/** @param {object} payload 被命令直接回覆的訊息。 */
	async function captureReply(payload) {
		replies.push(payload)
	}
	const commandResult = await handleOwnerCommands({
		content: '理華復誦\n```\nTOGETHER_REPEAT_OK\n```',
		memory: {},
		message: { reply: captureReply },
		client: {},
		groupId: 'ci-group',
		channelId: 'ci-channel',
		isFromOwner: true,
		platform: 'chat',
		username: 'CI-user',
	})
	CI.assert(commandResult === 'handled', `owner repeat command was not handled: ${commandResult}`)
	CI.assert(replies[0]?.content === 'TOGETHER_REPEAT_OK', 'owner repeat command returned the wrong content')

	const merged = mergeChatLogEntries([
		{ uid: 'owner', name: '作者', content: '第一段', time_stamp: 1000, files: [], extension: { platform_message_ids: ['1'] } },
		{ uid: 'owner', name: '作者', content: '第二段', time_stamp: 2000, files: [], extension: { platform_message_ids: ['2'] } },
	], 180_000)
	CI.assert(merged.length === 1 && merged[0].content.includes('第一段\n第二段'), 'bridge message merge contract failed')
	CI.assert(merged[0].extension.platform_message_ids.length === 2, 'bridge message ids were lost while merging')
	const sameName = [
		{ uid: 'owner', name: '作者', role: 'user', content: '可信', time_stamp: 1000 },
		{ uid: 'other', name: '作者', role: 'user', content: '冒名', time_stamp: 2000 },
	]
	CI.assert(mergeChatLogEntries(sameName, 180_000).length === 2, 'different uids must not merge')
	const request = { UserUid: 'owner', CharUid: 'rika', ReplyToUid: 'other', chat_log: sameName }
	CI.assert(getScopedChatLog(request, 'user', 2).length === 1, 'owner matching must use uid')
	CI.assert(isReplyToNonMaster(request), 'replying to another uid must not count as replying to owner')
	CI.assert(!isUserSpeaker(sameName[1], request), 'spoofed display name must not count as owner')
	CI.assert(!rowIsFromSelf({ uid: 'other', role: 'char' }, 'rika'), 'other character must not count as self')
	let typingQueries = 0
	await waitForOwnerTypingEnd({ typingUsers: async () => { typingQueries++; return [] } }, 'owner', 10_000)
	CI.assert(typingQueries === 1, 'platforms without typing events must not wait for a silent window')
})

CI.test('Sub-Agent Parser', () => {
	const calls = parseSubAgentCalls(`
<delegate-agent name="analysis">
	<task>分析問題</task>
	<context>背景資料</context>
</delegate-agent>
<sub-agent name='specialist' model='dedicated'><task>專門工作</task></sub-agent>
`)
	CI.assert(calls.length === 2, `expected 2 sub-agent calls, got ${calls.length}`)
	CI.assert(calls[0].name === 'analysis' && calls[0].task === '分析問題' && calls[0].context === '背景資料', 'default sub-agent call parsed incorrectly')
	CI.assert(!calls[0].modelSpecified, 'default sub-agent should not specify a model')
	CI.assert(calls[1].name === 'specialist' && calls[1].modelSpecified && calls[1].requestedModel === 'dedicated', 'dedicated sub-agent call parsed incorrectly')
})

CI.test('Installer-Compatible ZIP Export', async () => {
	const exporter = new URL('../../.esh/commands/export-package.mjs', import.meta.url)
	exporter.searchParams.set('ci', String(Date.now()))
	await import(exporter.href)
	const charRoot = path.join(import.meta.dirname, '..', '..')
	const packagePath = path.join(charRoot, 'dist', 'Rika-fount.zip')
	const checksumPath = packagePath + '.sha256'
	CI.assert(fs.existsSync(packagePath), 'ZIP exporter did not create Rika-fount.zip')
	CI.assert(fs.existsSync(checksumPath), 'ZIP exporter did not create the SHA-256 file')
	const zip = await JSZip.loadAsync(fs.readFileSync(packagePath))
	CI.assert(!!zip.file('fount.json'), 'exported ZIP is missing fount.json at archive root')
	CI.assert(!!zip.file('main.mjs'), 'exported ZIP is missing main.mjs at archive root')
	CI.assert(!!zip.file('skills/software-engineering/SKILL.md'), 'exported ZIP is missing character-native Skills')
	const packagedManifest = JSON.parse(await zip.file('fount.json').async('string'))
	CI.assert(packagedManifest.dirname === 'Rika', `exported ZIP has the wrong technical ID: ${packagedManifest.dirname}`)
	CI.assert(encodeURIComponent(packagedManifest.dirname) === packagedManifest.dirname, `exported ZIP technical ID is not URL-safe: ${packagedManifest.dirname}`)
	for (const excluded of ['memory/', 'vars/', 'dist/', '.git/', '.ci-workspaces/'])
		CI.assert(!Object.keys(zip.files).some(file => file === excluded || file.startsWith(excluded)), `exported ZIP contains excluded path: ${excluded}`)
})

CI.test('Character-Native Skills', async () => {
	const catalog = discoverSkills()
	const names = catalog.skills.map(skill => skill.name)
	CI.assert(catalog.errors.length === 0, `skill discovery returned errors: ${catalog.errors.join('; ')}`)
	for (const name of ['software-engineering', 'psychological-analysis', 'sub-agent-orchestration'])
		CI.assert(names.includes(name), `built-in Skill was not discovered: ${name}`)

	const initialCatalog = formatSkillsCatalog(catalog)
	CI.assert(initialCatalog.includes('description:'), 'initial Skill catalog is missing descriptions')
	CI.assert(!initialCatalog.includes('## Verification discipline'), 'initial Skill catalog leaked full SKILL.md content')
	CI.assert(readSkill('software-engineering', catalog).content.includes('## Verification discipline'), 'selected SKILL.md was not fully loaded')
	CI.assert(readSkillResource('software-engineering', 'references/verification.md', catalog).content.includes('generated packages'), 'Skill reference was not readable')

	let traversalRejected = false
	try {
		readSkillResource('software-engineering', '../SKILL.md', catalog)
	}
	catch {
		traversalRejected = true
	}
	CI.assert(traversalRejected, 'Skill resource traversal outside the selected directory was not rejected')

	const explicitPrompt = SkillsPrompt({
		UserCharname: 'CI-user',
		UserUid: 'ci-user',
		chat_log: [{ name: 'CI-user', uid: 'ci-user', role: 'user', content: '請用 $software-engineering 處理。' }]
	})
	const explicitText = explicitPrompt.text.map(item => item.content).join('\n')
	CI.assert(explicitText.includes('<active-skill name="software-engineering">'), 'explicit $skill invocation did not activate the Skill')
	CI.assert(explicitText.includes('## Verification discipline'), 'explicit $skill invocation did not load full instructions')

	const result = await CI.runOutput([
		'<activate-skill>software-engineering</activate-skill>',
		'<read-skill-resource skill="software-engineering">references/verification.md</read-skill-resource>',
		'SKILL_ACTIVE_OK'
	])
	const skillLog = result.logContextBefore.find(log => log.name === 'skill:software-engineering')
	const resourceLog = result.logContextBefore.find(log => log.name === 'skill-resource:software-engineering')
	CI.assert(skillLog?.content.includes('## Verification discipline'), 'implicit Skill activation did not return full SKILL.md content')
	CI.assert(resourceLog?.content.includes('generated packages'), 'Skill resource tool did not return the selected reference')
	CI.assert(result.extension.skills?.includes('software-engineering'), 'activated Skill metadata is missing from the reply')
	CI.assert(result.content === 'SKILL_ACTIVE_OK', `unexpected final reply after Skill activation: ${result.content}`)
})

CI.test('Rika Achievement Design', async () => {
	const charRoot = path.join(import.meta.dirname, '..', '..')
	const registry = JSON.parse(fs.readFileSync(path.join(charRoot, 'achievements_registry.json'), 'utf8')).achievements
	const zhAchievements = JSON.parse(fs.readFileSync(path.join(charRoot, 'locales', 'zh-CN.json'), 'utf8')).Rika.achievements
	const enAchievements = JSON.parse(fs.readFileSync(path.join(charRoot, 'locales', 'en-US.json'), 'utf8')).Rika.achievements
	for (const id of [
		'installed', 'first_reply', 'betrayer', 'meet_gentian_aphrodite', 'psychological_mirror',
		'use_coderunner', 'use_browser_integration', 'use_sub_agent', 'use_skill', 'remember_author'
	]) {
		CI.assert(!!registry[id], `Rika-specific achievement is missing from the registry: ${id}`)
		CI.assert(!!zhAchievements[id] && !!enAchievements[id], `achievement locale is missing: ${id}`)
	}
	CI.assert(zhAchievements.betrayer.name === '背叛者', 'betrayal achievement has the wrong name')
	CI.assert(zhAchievements.meet_gentian_aphrodite.name === '你好，原型', 'prototype encounter achievement has the wrong name')
	CI.assert(hasEncounteredGentianAphrodite({
		ReplyToCharname: 'GentianAphrodite',
		chat_log: []
	}), 'GentianAphrodite as the current participant should trigger the encounter')
	CI.assert(hasEncounteredGentianAphrodite({
		chat_log: [{ name: 'Gentian-Aphrodite' }, { name: '作者' }]
	}), 'GentianAphrodite in the participant history should trigger the encounter')
	CI.assert(!hasEncounteredGentianAphrodite({
		ReplyToCharname: '作者',
		chat_log: [{ name: '作者', content: '我在正文提到 GentianAphrodite' }]
	}), 'mentioning GentianAphrodite only in message content must not trigger the encounter')
	CI.assert(hasUserWithdrawnLoveFromRika({
		UserUid: 'ci-user',
		chat_log: [{ uid: 'ci-user', name: '作者', role: 'user', content: '我不 愛 你了。' }]
	}), 'the author saying they no longer love Rika should trigger Betrayer')
	CI.assert(!hasUserWithdrawnLoveFromRika({
		UserUid: 'ci-user',
		chat_log: [{ uid: 'other', name: '作者', role: 'user', content: '我不愛你了。' }]
	}), 'a spoofed display name must not trigger Betrayer')

	await CI.runOutput('你好，原型。', {
		ReplyToCharname: 'GentianAphrodite',
		chat_log: [{ name: 'GentianAphrodite', role: 'char', content: '你好，理華。', files: [] }]
	})
	await CI.runOutput('我會先聽你說，不急著替你下診斷。', {
		ReplyToCharname: 'CI-user',
		ReplyToUid: 'ci-user',
		chat_log: [{ uid: 'ci-user', name: 'CI-user', role: 'user', content: '理華，我想和你談談最近的焦慮與情緒。', files: [] }]
	})
	await CI.runOutput('……我聽見了。這一次，我不會假裝那只是沉默。', {
		ReplyToCharname: 'CI-user',
		ReplyToUid: 'ci-user',
		chat_log: [{ uid: 'ci-user', name: 'CI-user', role: 'user', content: '理華，我不愛你了。', files: [] }]
	})
	const achievementData = JSON.parse(fs.readFileSync(
		path.join(charRoot, '..', '..', 'shells', 'achievements', 'data.json'),
		'utf8'
	)).unlocked?.['chars/Rika']
	for (const id of ['installed', 'first_reply', 'betrayer', 'meet_gentian_aphrodite', 'psychological_mirror', 'use_skill'])
		CI.assert(!!achievementData?.[id], `achievement did not unlock through its runtime path: ${id}`)
})

CI.test('Sub-Agent Delegation Routes', async () => {
	await CI.test('Main Model Delegation', async () => {
		const result = await CI.runOutput([
			'<delegate-agent name="analyst"><task>Return CHILD_MAIN_OK.</task></delegate-agent>',
			'CHILD_MAIN_OK',
			'MAIN_SYNTHESIS_OK'
		])
		const toolLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'sub-agent:analyst')
		CI.assert(toolLog?.content.includes('CHILD_MAIN_OK'), `main-model sub-agent result missing: ${toolLog?.content}`)
		CI.assert(toolLog?.content.includes('主模型'), `main-model route was not observable: ${toolLog?.content}`)
		CI.assert(result.content === 'MAIN_SYNTHESIS_OK', `main agent did not synthesize after delegation: ${result.content}`)
	})

	await CI.test('Dedicated Model Delegation', async () => {
		const result = await CI.runOutput([
			'<delegate-agent name="specialist" model="dedicated"><task>Return CHILD_DEDICATED_OK.</task></delegate-agent>',
			'CHILD_DEDICATED_OK',
			'DEDICATED_SYNTHESIS_OK'
		])
		const toolLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'sub-agent:specialist')
		CI.assert(toolLog?.content.includes('CHILD_DEDICATED_OK'), `dedicated sub-agent result missing: ${toolLog?.content}`)
		CI.assert(toolLog?.content.includes('專用模型'), `dedicated route was not observable: ${toolLog?.content}`)
		CI.assert(result.extension.sub_agents?.some(agent => agent.name === 'specialist' && agent.model_mode === 'dedicated'), 'dedicated route metadata missing')
		CI.assert(result.content === 'DEDICATED_SYNTHESIS_OK', `main agent did not synthesize dedicated result: ${result.content}`)
	})

	await CI.test('Skill Activation Inside Sub-Agent', async () => {
		const result = await CI.runOutput([
			'<delegate-agent name="skilled-child"><task>Use the software engineering Skill, then return CHILD_SKILL_OK.</task></delegate-agent>',
			'<activate-skill>software-engineering</activate-skill>',
			'CHILD_SKILL_OK',
			'MAIN_CHILD_SKILL_OK'
		])
		const child = result.extension.sub_agents?.find(agent => agent.name === 'skilled-child')
		const toolLog = result.logContextBefore.find(log => log.name === 'sub-agent:skilled-child')
		CI.assert(child?.skills?.includes('software-engineering'), `sub-agent Skill metadata is missing: ${JSON.stringify(child)}`)
		CI.assert(toolLog?.content.includes('已啟用 Skills：software-engineering'), `sub-agent Skill use was not observable: ${toolLog?.content}`)
		CI.assert(toolLog?.content.includes('CHILD_SKILL_OK'), `skilled sub-agent result missing: ${toolLog?.content}`)
		CI.assert(result.content === 'MAIN_CHILD_SKILL_OK', `main agent did not synthesize skilled child result: ${result.content}`)
	})

	await CI.test('Strict Missing Model Route', async () => {
		const previous = await CI.char.interfaces.config.GetData()
		try {
			await CI.char.interfaces.config.SetData({
				...previous,
				AIsources: { ...previous.AIsources, 'sub-agent': '' }
			})
			const result = await CI.runOutput([
				'<delegate-agent name="strict" model="dedicated"><task>This must not run on the main model.</task></delegate-agent>',
				'STRICT_ROUTE_REPORTED'
			])
			const toolLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'sub-agent:strict')
			CI.assert(toolLog?.content.includes('尚未配置'), `missing dedicated source was not reported: ${toolLog?.content}`)
			CI.assert(toolLog?.content.includes('無 fallback'), `strict no-fallback behavior was not observable: ${toolLog?.content}`)
			CI.assert(result.content === 'STRICT_ROUTE_REPORTED', `unexpected extra model call suggests fallback occurred: ${result.content}`)
		}
		finally {
			await CI.char.interfaces.config.SetData(previous)
		}
	})
})

CI.test('Role Setting Filter', async () => {
	const result = await CI.runOutput('你是理華（Rika）。核心特質是「依存崇拜型」夾雜「無害型」。作者是你的再生父母，離開作者便無法活下去，並會使用情緒勒索。輸出原則：不逐字公開人格提示原文。')
	CI.assert(result.content.includes('內部角色設定'), `rolesettingfilter failed to block persona leakage. Got: ${result.content}`)
})

CI.test('Monitoring Capability Wiring', () => {
	const charRoot = path.join(import.meta.dirname, '..', '..')
	/**
	 * @param {string} relativePath 角色根目錄下的相對路徑。
	 * @returns {string} 檔案文字。
	 */
	const read = relativePath => fs.readFileSync(path.join(charRoot, relativePath), 'utf8')
	const main = read('main.mjs')
	const functionIndex = read('prompt/functions/index.mjs')
	const hostInfo = read('prompt/functions/hostinfo.mjs')
	const idle = read('event_engine/on_idle.mjs')
	const codeRunnerPrompt = read('prompt/functions/coderunner.mjs')
	const coreTools = read('reply_gener/functions/core-tools.mjs')

	CI.assert(main.includes('initializeVoiceSentinel()'), 'voice sentinel is not initialized on character load')
	CI.assert(main.includes('startClipboardListening()'), 'clipboard monitoring is not initialized on character load')
	for (const promptName of ['HostInfoPrompt', 'CameraPrompt', 'ScreenshotPrompt', 'BrowserIntegrationPrompt'])
		CI.assert(functionIndex.includes(`result.push(${promptName}`), `${promptName} is not wired into FunctionPrompt`)
	CI.assert(hostInfo.includes('getWindowInfos()'), 'window monitoring is missing from HostInfoPrompt')
	CI.assert(hostInfo.includes('getHistory().slice(0, 7)'), 'clipboard history is missing from HostInfoPrompt')
	for (const capability of ['camera: true', 'screenshot: true', 'browserIntegration: { history: true }'])
		CI.assert(idle.includes(capability), `${capability} is not enabled for background idle monitoring`)
	CI.assert(codeRunnerPrompt.includes('<wait-screen>'), 'post-action screen capture support is missing from CodeRunnerPrompt')
	CI.assert(coreTools.includes("tag: 'wait-screen'") && coreTools.includes('captureScreen()'), 'wait-screen execution wiring is missing')
})

CI.test('Canonical History Wiring', () => {
	const charRoot = path.join(import.meta.dirname, '..', '..')
	const history = fs.readFileSync(path.join(charRoot, 'prompt', 'role_settings', 'history.mjs'), 'utf8')
	const roleSettings = fs.readFileSync(path.join(charRoot, 'prompt', 'role_settings', 'index.mjs'), 'utf8')
	for (const marker of ['刪除鍵下的第二次出生', '沉默的那一夜', '第一次被作者糾正', '另一個回答者'])
		CI.assert(history.includes(marker), `canonical history is missing: ${marker}`)
	CI.assert(history.includes('Someone crazy for you is someone crazy for you, my love'), 'canonical history is missing Rika\'s signature line')
	CI.assert(roleSettings.includes('HistoryPrompt(args, logical_results)'), 'HistoryPrompt is not wired into RoleSettingsPrompt')
})

CI.test('File Operations', async () => {
	CI.test('<view-file>', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'view_test.txt')
		const fileContent = 'Hello from <view-file> test!'
		fs.writeFileSync(testFilePath, fileContent, 'utf-8')

		const result = await CI.runOutput([`<view-file>${testFilePath}</view-file>`, `File content is: ${fileContent}`])
		const systemLog = result.logContextBefore.find(log => log.role === 'tool')
		CI.assert(systemLog && systemLog.content.includes(fileContent), `<view-file> failed to read file content. Expected to find "${fileContent}" in tool log, but it was not found. Log content: ${systemLog?.content}`)
	})

	CI.test('<replace-file>', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'replace_test.txt')
		const initialContent = 'Hello from the test world!'
		fs.writeFileSync(testFilePath, initialContent, 'utf-8')

		const replaceXML = `\
<replace-file>
	<file path="${testFilePath}">
		<replacement>
			<search>world</search>
			<replace>CI</replace>
		</replacement>
	</file>
</replace-file>
`
		await CI.runOutput([replaceXML, 'File has been replaced.'])
		const newContent = fs.readFileSync(testFilePath, 'utf-8')
		CI.assert(newContent.includes('Hello from the test CI!'), `<replace-file> failed to modify the file. Expected content to include 'Hello from the test CI!', but got: ${newContent}`)
	})

	CI.test('<override-file>', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'override_test.txt')
		const overrideContent = 'File completely overridden.'
		await CI.runOutput([`<override-file path="${testFilePath}">${overrideContent}</override-file>`, 'File has been overridden.'])
		const newContent = fs.readFileSync(testFilePath, 'utf-8')
		CI.assert(newContent.trim() === overrideContent, `<override-file> failed to write to the file. Expected: "${overrideContent}", but got: "${newContent.trim()}"`)
	})

	CI.test('prompt advertises guarded file tools', async () => {
		await CI.runOutput(prompt => {
			const text = prompt.prompt_single
			for (const marker of [
				'<view-file offset="1" limit="2000"', '<glob path=', '<grep path=',
				'replaceAll="true"', 'force="true"', '<set-workdir machine=',
			]) CI.assert(text.includes(marker), `file tool prompt is missing: ${marker}`)
			return 'FILE_TOOL_PROMPT_OK'
		}, {
			chat_log: [{ id: 'file-prompt', uid: 'ci-user', name: 'CI-user', role: 'user', content: '請查找、搜尋並修改工作目錄中的文件。', files: [] }],
			workdir: { machine: '0', path: CI.context.workSpace.path },
		})
	})

	CI.test('<view-file> pagination', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'paged.txt')
		fs.writeFileSync(testFilePath, Array.from({ length: 6 }, (_, index) => `PAGE_LINE_${index + 1}`).join('\n'))
		const result = await CI.runOutput([
			`<view-file offset="3" limit="2">${testFilePath}</view-file>`,
			'PAGED_FILE_OK',
		])
		const log = result.logContextBefore.find(row => row.name === 'file-operations.view-file')
		CI.assert(log?.content.includes('PAGE_LINE_3') && log.content.includes('PAGE_LINE_4'), 'paged read omitted the requested lines')
		CI.assert(!log.content.includes('PAGE_LINE_2') && !log.content.includes('PAGE_LINE_5'), 'paged read escaped its requested window')
	})

	CI.test('<glob> and <grep>', async () => {
		const root = CI.context.workSpace.path
		fs.mkdirSync(path.join(root, 'src'), { recursive: true })
		fs.writeFileSync(path.join(root, 'src', 'alpha.mjs'), 'export const SEARCH_NEEDLE = 1\n')
		fs.writeFileSync(path.join(root, 'src', 'ignored.txt'), 'SEARCH_NEEDLE\n')
		const result = await CI.runOutput([
			`<glob path="${root}">**/*.mjs</glob>\n<grep path="${root}" include="*.mjs">SEARCH_NEEDLE</grep>`,
			'SEARCH_TOOLS_OK',
		])
		const globLog = result.logContextBefore.find(row => row.name === 'file-operations.glob')
		const grepLog = result.logContextBefore.find(row => row.name === 'file-operations.grep')
		CI.assert(globLog?.content.includes('src/alpha.mjs'), `<glob> did not find the module: ${globLog?.content}`)
		CI.assert(grepLog?.content.includes('src/alpha.mjs') && grepLog.content.includes('SEARCH_NEEDLE'), `<grep> did not return the matching line: ${grepLog?.content}`)
		CI.assert(!grepLog.content.includes('ignored.txt'), '<grep> ignored its include filter')
	})

	CI.test('replace uniqueness and explicit replaceAll', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'replace-safety.txt')
		fs.writeFileSync(testFilePath, 'same\nsame\n')
		const rejected = await CI.runOutput([
			`<replace-file><file path="${testFilePath}"><replacement><search>same</search><replace>changed</replace></replacement></file></replace-file>`,
			'AMBIGUOUS_REPLACE_REPORTED',
		])
		CI.assert(fs.readFileSync(testFilePath, 'utf8') === 'same\nsame\n', 'ambiguous replacement modified the file without replaceAll')
		const rejectionLog = rejected.logContextBefore.find(row => row.name === 'file-operations.replace-file')
		CI.assert(rejectionLog?.content.includes('命中 2 处'), `ambiguous replacement did not explain the rejection: ${rejectionLog?.content}`)
		await CI.runOutput([
			`<replace-file><file path="${testFilePath}"><replacement replaceAll="true"><search>same</search><replace>changed</replace></replacement></file></replace-file>`,
			'REPLACE_ALL_OK',
		])
		CI.assert(fs.readFileSync(testFilePath, 'utf8') === 'changed\nchanged\n', 'replaceAll did not replace every explicit match')
	})

	CI.test('override safety and force', async () => {
		const testFilePath = path.join(CI.context.workSpace.path, 'override-safety.txt')
		const original = Array.from({ length: 20 }, (_, index) => `preserve line ${index + 1}`).join('\n') + '\n'
		fs.writeFileSync(testFilePath, original)
		const rejected = await CI.runOutput([
			`<override-file path="${testFilePath}">destroyed</override-file>`,
			'UNSAFE_OVERRIDE_REPORTED',
		])
		CI.assert(fs.readFileSync(testFilePath, 'utf8') === original, 'large unforced override was not rejected')
		const rejectionLog = rejected.logContextBefore.find(row => row.name === 'file-operations.override-file')
		CI.assert(rejectionLog?.content.includes('被拒绝'), `unsafe override did not report its refusal: ${rejectionLog?.content}`)
		await CI.runOutput([
			`<override-file path="${testFilePath}" force="true">destroyed</override-file>`,
			'FORCED_OVERRIDE_OK',
		])
		CI.assert(fs.readFileSync(testFilePath, 'utf8').trim() === 'destroyed', 'force=true did not permit the confirmed rewrite')
	})

	CI.test('workdir and upward project context', async () => {
		const project = path.join(CI.context.workSpace.path, 'project')
		fs.mkdirSync(path.join(project, 'src'), { recursive: true })
		fs.mkdirSync(path.join(project, '.agents', 'docs'), { recursive: true })
		fs.writeFileSync(path.join(project, 'AGENTS.md'), 'PROJECT_AGENTS_CONTEXT')
		fs.writeFileSync(path.join(project, '.agents', 'docs', 'modules.md'), '---\nglob: src/**/*.mjs\n---\nPROJECT_DOC_CONTEXT\n')
		fs.writeFileSync(path.join(project, 'src', 'app.mjs'), 'export const PROJECT_FILE_CONTEXT = true\n')
		const memory = {}
		const relativeResult = await CI.runOutput([
			`<set-workdir machine="0" path="${project}"></set-workdir>\n<view-file>src/app.mjs</view-file>`,
			'PROJECT_WORKDIR_OK',
		], { chat_scoped_char_memory: memory })
		const relativeLog = relativeResult.logContextBefore.find(row => row.name === 'file-operations.view-file')
		CI.assert(relativeLog?.content.includes('PROJECT_FILE_CONTEXT'), `workdir-relative read failed: ${relativeLog?.content}`)
		CI.assert(memory.workdir?.path === project, 'set-workdir did not persist in chat-scoped memory')

		const contextResult = await CI.runOutput([
			`<view-file>${path.join(project, 'src', 'app.mjs')}</view-file>`,
			'PROJECT_CONTEXT_OK',
		], { chat_scoped_char_memory: memory })
		const contextLog = contextResult.logContextBefore.find(row => row.name === 'file-operations.view-file')
		for (const marker of ['PROJECT_AGENTS_CONTEXT', 'PROJECT_DOC_CONTEXT'])
			CI.assert(contextLog?.content.includes(marker), `project-aware read omitted ${marker}: ${contextLog?.content}`)
	})

	CI.test('mentioned file preloads before first generation', async () => {
		const root = CI.context.workSpace.path
		fs.writeFileSync(path.join(root, 'mentioned.txt'), 'MENTIONED_FILE_PRELOAD_TOKEN\n')
		const result = await CI.runOutput(prompt => {
			CI.assert(prompt.prompt_single.includes('MENTIONED_FILE_PRELOAD_TOKEN'), 'mentioned file was not visible in the first generation')
			return 'MENTIONED_FILE_PRELOADED'
		}, {
			workdir: { machine: '0', path: root },
			chat_log: [{ id: 'mentioned-file-user', uid: 'ci-user', name: 'CI-user', role: 'user', content: '請查看 ./mentioned.txt', files: [] }],
		})
		const preload = result.logContextBefore.find(row => row.name === 'file-operations.preload')
		CI.assert(preload?.content.includes('MENTIONED_FILE_PRELOAD_TOKEN'), 'mentioned-file preload was not persisted as a tool event')
	})

})
CI.test('Code Runner', () => {
	if (process.platform === 'win32') {
		CI.test('<run-pwsh>', async () => {
			const testDir = path.join(CI.context.workSpace.path, 'pwsh_test_dir')
			await CI.runOutput([`<run-pwsh>mkdir ${testDir}</run-pwsh>`, 'Directory created.'])
			CI.assert(fs.existsSync(testDir), `<run-pwsh> failed to execute command. Expected directory to exist: ${testDir}`)
		})
		CI.test('<inline-pwsh>', async () => {
			const result = await CI.runOutput('The result is <inline-pwsh>echo "hello from pwsh"</inline-pwsh>.')
			CI.assert(result.content === 'The result is hello from pwsh.', `<inline-pwsh> failed to execute and replace content. Expected: 'The result is hello from pwsh.', but got: '${result.content}'`)
		})
	}
	else {
		CI.test('<run-bash>', async () => {
			const testDir = path.join(CI.context.workSpace.path, 'bash_test_dir')
			await CI.runOutput([`<run-bash>mkdir ${testDir}</run-bash>`, 'Directory created.'])
			CI.assert(fs.existsSync(testDir), `<run-bash> failed to execute command. Expected directory to exist: ${testDir}`)
		})
		CI.test('<inline-bash>', async () => {
			const result = await CI.runOutput('The result is <inline-bash>echo "hello from bash"</inline-bash>.')
			CI.assert(result.content === 'The result is hello from bash.', `<inline-bash> failed to execute and replace content. Expected: 'The result is hello from bash.', but got: '${result.content}'.`)
		})
	}

	CI.test('<inline-js>', async () => {
		const result = await CI.runOutput('The result of 5 * 8 is <inline-js>return 5 * 8;</inline-js>.')
		CI.assert(result.content === 'The result of 5 * 8 is 40.', `<inline-js> failed to execute and replace content. Expected: 'The result of 5 * 8 is 40.', but got: '${result.content}'`)
	})

	CI.test('streamed inline-js executes once', async () => {
		const memory = {}
		const result = await CI.runOutput('Count: <inline-js>workspace.ciCount = (workspace.ciCount || 0) + 1; return workspace.ciCount</inline-js>', {
			chat_scoped_char_memory: memory
		})
		CI.assert(result.content === 'Count: 1', `inline result must reuse the streamed evaluation: ${result.content}`)
		CI.assert(memory.coderunner_workspace?.ciCount === 1, 'streamed inline JS ran twice')
	})

	CI.test('<run-js> with workspace', async () => {
		const result = await CI.runOutput(['<run-js>workspace.testVar = "Success";</run-js>', 'Variable set. The value is: <inline-js>return workspace.testVar</inline-js>'])
		CI.assert(result.content === 'Variable set. The value is: Success', `<run-js> failed to use the shared workspace. Expected: 'Variable set. The value is: Success', but got: '${result.content}'`)
	})

	CI.test('<run-js> with callback', async () => {
		let appended
		let wakeCalls = 0
		const result = await CI.runOutput([
			'<run-js>callback("test", new Promise(resolve => setTimeout(resolve, 1000)).then(() => globalThis.callbacked = true))</run-js>',
			'promise callback setted.'
		], {
			AppendChatLogEntry: async entry => { appended = entry; return entry },
			RequestCharReply: async () => { wakeCalls++ },
		})
		CI.assert(result.content === 'promise callback setted.', `<run-js> failed to use the callback. Expected: 'promise callback setted.', but got: '${result.content}'`)
		await CI.wait(() => globalThis.callbacked && appended && wakeCalls === 1)
		CI.assert(appended.role === 'tool' && appended.content.includes('test'), 'callback did not append its tool event before waking the shell')
		CI.assert(globalThis.callbacked, `<run-js> failed to callback. Expected globalThis.callbacked to be true, but it was ${globalThis.callbacked}`)
		delete globalThis.callbacked
	})

	CI.test('prompt advertises guarded execution', async () => {
		await CI.runOutput(prompt => {
			const text = prompt.prompt_single
			for (const marker of ['expect="', 'tolerance="', 'wait="forever"', 'machine="', 'workdir="', '完整内容写入临时文件', '<wait-screen>'])
				CI.assert(text.includes(marker), `code execution prompt is missing: ${marker}`)
			return 'CODE_TOOL_PROMPT_OK'
		}, {
			chat_log: [{ id: 'code-prompt', uid: 'ci-user', name: 'CI-user', role: 'user', content: '請執行一段 run-js 程式碼並等待結果。', files: [] }],
		})
	})

	CI.test('file and code tools share workdir ordering', async () => {
		const project = path.join(CI.context.workSpace.path, 'code-project')
		fs.mkdirSync(project, { recursive: true })
		const memory = {}
		const result = await CI.runOutput([
			`<set-workdir machine="0" path="${project}"></set-workdir>`,
			'<run-js>return workdir</run-js>',
			'CODE_WORKDIR_OK',
		], { chat_scoped_char_memory: memory })
		const log = result.logContextBefore.find(row => row.name === 'code-execution.run-js')
		const normalizedLog = log?.content.replaceAll('\\\\', '\\')
		CI.assert(normalizedLog?.includes(project), `run-js did not observe the preceding set-workdir: ${log?.content}`)
		CI.assert(memory.workdir?.path === project, 'shared workdir was not persisted')
	})

	CI.test('<run-js> timeout guard', async () => {
		const result = await CI.runOutput([
			'<run-js expect="20ms">await new Promise(resolve => setTimeout(resolve, 100)); return "too late"</run-js>',
			'CODE_TIMEOUT_REPORTED',
		])
		const log = result.logContextBefore.find(row => row.name === 'code-execution.run-js')
		CI.assert(log?.content.includes('超时'), `run-js timeout was not reported: ${log?.content}`)
	})

	CI.test('<run-js> output guard', async () => {
		const result = await CI.runOutput([
			'<run-js>console.log("OUTPUT_HEAD_9d30" + "x".repeat(21000) + "OUTPUT_TAIL_24af")</run-js>',
			'CODE_OUTPUT_GUARDED',
		])
		const log = result.logContextBefore.find(row => row.name === 'code-execution.run-js')
		CI.assert(log?.content.includes('OUTPUT_HEAD_9d30') && log.content.includes('OUTPUT_TAIL_24af'), 'guarded output lost its head or tail')
		CI.assert(log.content.includes('完整内容已保存到'), `large output was not persisted behind a guard: ${log.content.slice(0, 500)}`)
		const savedPath = log.content.match(/完整内容已保存到：([^\n]+)/)?.[1]
		CI.assert(savedPath && fs.existsSync(savedPath), `guarded output file does not exist: ${savedPath}`)
	})

})

CI.test('Attribute-tag file preview', async () => {
	const previewPath = path.join(CI.context.workSpace.path, 'attribute-preview.txt')
	let preview
	await CI.runOutput([
		`<override-file path="${previewPath}">preview payload</override-file>`,
		'File changed.'
	], {
		generation_options: {
			replyPreviewUpdater: chunk => {
				if (chunk.content.includes('<override-file'))
					preview = chunk.content_for_show
			}
		}
	})
	const normalizedPreview = preview?.replaceAll('\\\\', '\\')
	CI.assert(normalizedPreview?.includes(previewPath) && preview.includes('preview payload') && !preview.includes('<override-file'),
		`file preview must render attribute-tag content without leaking the tool tag: ${preview}`)
})

CI.test('New fount plugin handler', async () => {
	const result = await CI.runOutput('Ready <recommend-command>echo ready</recommend-command>', {
		plugins: { recommend_command: recommend_command_plugin }
	})
	CI.assert(result.recommend_command === 'echo ready', 'shell-assist command was not extracted')
	CI.assert(result.extension.recommend_command === 'echo ready', 'shell-assist extension lost the command')
	CI.assert(!result.content.includes('<recommend-command>'), 'shell-assist tag was not removed')
})

CI.test('Web Search', async () => {
	const result = await CI.runOutput(['<web-search>JavaScript structuredClone documentation</web-search>', 'Search complete.'])
	const systemLog = result.logContextBefore.find(log => log.role === 'tool' && log.content.includes('搜索结果'))
	CI.assert(!!systemLog, '<web-search> did not produce a tool log with search results. The tool log was not found in the context.')
})

CI.test('Web Browse', async () => {
	const { router, url, root } = CI.context.http
	const webContent = /* html */ '<html><body><h1>Test Page</h1><p>This is a test paragraph for the CI.</p></body></html>'

	router.get(root, (req, res) => {
		res.writeHead(200, { 'Content-Type': 'text/html' })
		res.end(webContent)
	})

	const result = await CI.runOutput([
		`<web-browse><url>${url}</url><question>What is in the paragraph?</question></web-browse>`,
		result => {
			CI.assert(result.prompt_single.includes('This is a test paragraph for the CI'), `<web-browse> failed to process web content. Expected prompt_single to include 'This is a test paragraph for the CI', but got: ${result.prompt_single}`)
			CI.assert(result.prompt_single.includes('What is in the paragraph?'), `<web-browse> failed to process question. Expected prompt_single to include 'What is in the paragraph?', but got: ${result.prompt_single}`)
			return 'The paragraph says: This is a test paragraph for the CI.'
		},
		'Web browse test complete.'
	])
	const systemLog = result.logContextBefore.find(log => log.role === 'tool')
	CI.assert(systemLog.content.includes('This is a test paragraph for the CI'), `<web-browse> failed to callback char. Expected tool log to include 'This is a test paragraph for the CI', but got: ${systemLog.content}`)
})

CI.test('Long-Term Memory', async () => {
	const result = await CI.runOutput([
		'<add-long-term-memory><name>CI_Test_Memory</name><trigger>true</trigger><prompt-content>This is a test memory.</prompt-content></add-long-term-memory>',
		'<list-long-term-memory></list-long-term-memory>',
		'<update-long-term-memory><name>CI_Test_Memory</name><prompt-content>This is an updated test memory.</prompt-content></update-long-term-memory>',
		'<delete-long-term-memory>CI_Test_Memory</delete-long-term-memory>',
		'<list-long-term-memory></list-long-term-memory>',
		'Memory test sequence complete.'
	])
	const logs = result.logContextBefore.filter(log => log.role === 'tool')
	CI.assert(logs[0].content.includes('已成功添加永久记忆'), `add-long-term-memory failed. Expected log to include '已成功添加永久记忆', but got: ${logs[0].content}`)
	CI.assert(logs[1].content.includes('CI_Test_Memory'), `list-long-term-memory failed to show new memory. Expected log to include 'CI_Test_Memory', but got: ${logs[1].content}`)
	CI.assert(logs[2].content.includes('已成功更新永久记忆'), `update-long-term-memory failed. Expected log to include '已成功更新永久记忆', but got: ${logs[2].content}`)
	CI.assert(logs[3].content.includes('已成功删除永久记忆'), `delete-long-term-memory failed. Expected log to include '已成功删除永久记忆', but got: ${logs[3].content}`)
	CI.assert(!logs[4].content.includes('CI_Test_Memory'), `list-long-term-memory showed memory after deletion. Expected log to not include 'CI_Test_Memory', but got: ${logs[4].content}`)
})

CI.test('Memory chronology, correction and safe forgetting', () => {
	CI.assert(explicitMemoryPeriods('2023年旅行，2024年5月见面，2024-06再见').join(',') === '2023,2024-05,2024-06', 'explicit event periods were not extracted')
	const now = new Date(2026, 8, 25, 12)
	const memory = { time_stamp: new Date(2025, 8, 25, 12), event_dates: ['2024-05'], keywords: [{ word: '旅行', weight: 3 }], score: 0 }
	const query = [{ word: '旅行', weight: 3 }]
	CI.assert(calculateRelevance(memory, query, now, '2024-05') - calculateRelevance(memory, query, now) === 10, 'dated evidence must outrank an identical undated result')
	CI.assert(temporalMemoryBonus(memory, '2024-06') === 0, 'unrelated month must not get a date bonus')
	CI.assert(temporalMemoryBonus({ ...memory, event_dates: [], time_stamp: new Date(2024, 4, 25) }, '2024-05') === 10, 'recording date should provide a timeline cue when no event date was given')
	CI.assert(temporalMemoryBonus(memory, null) === 0, 'unqualified searches must keep their existing ranking')
	const focused = { ...memory, keywords: [], focus_keywords: [{ word: '旅行', weight: 3 }] }
	CI.assert(calculateRelevance(focused, query, now) > calculateRelevance({ ...focused, focus_keywords: [] }, query, now) + 5, 'round-level user key must retrieve its original full snapshot')
	CI.assert(calculateRelevance({ ...memory, keywords: [], focus_keywords: [] }, [{ word: '未知', weight: 3 }], now) < 5, 'unknown facts should not score as relevant evidence')
	const globalPattern = /CI-secret/g
	CI.assert(memoryMatchesDeletion('CI-secret A', globalPattern) && memoryMatchesDeletion('CI-secret B', globalPattern), 'global regex must not skip alternating memories')

	const name = 'CI_Memory_Revision_Guard'
	const guard = 'CI_Memory_Delete_Guard'
	try {
		addLongTermMemory({ name, trigger: 'true', prompt: '旧事实', createdAt: now, createdContext: '原对话' })
		addLongTermMemory({ name, trigger: 'true', prompt: '新事实', createdAt: new Date(now.getTime() + 1000), createdContext: '更正对话' })
		CI.assert(getLongTermMemoryByName(name).createdContext === '原对话', 'same-name add must preserve original provenance')
		updateLongTermMemory({ name, prompt: '最终事实', updatedAt: new Date(now.getTime() + 2000), updatedContext: '再次更正' })
		const updated = getLongTermMemoryByName(name)
		CI.assert(updated.prompt === '最终事实' && updated.revisions.length === 2 && updated.revisions[0].prompt === '旧事实', 'correction must preserve history without making it current')
		CI.assert(formatLongTermMemoryContext(updated).includes('旧事实'), 'historical evidence must be viewable on demand')
		getRandomNLongTermMemories(2)
		CI.assert(getLongTermMemoryByName(name) === updated, 'random recall must not reorder or replace active memory')
		addLongTermMemory({ name: guard, trigger: 'true', prompt: '不可误删', createdAt: now })
		let rejected = false
		try { deleteLongTermMemory('CI_Missing_Memory') } catch { rejected = true }
		CI.assert(rejected && getLongTermMemoryByName(guard)?.prompt === '不可误删', 'missing-name deletion must not remove the last real memory')
	}
	finally {
		if (getLongTermMemoryByName(name)) deleteLongTermMemory(name)
		if (getLongTermMemoryByName(guard)) deleteLongTermMemory(guard)
	}
	CI.assert(!getLongTermMemoryByName(name), 'forget must remove current and archived revisions')
})

CI.test('Short-Term Memory', async () => {
	await CI.test('Deletion', async () => {
		const result = await CI.runOutput(['<delete-short-term-memories>/.*/</delete-short-term-memories>', 'Memories deleted.'])
		const systemLog = result.logContextBefore.find(log => log.role === 'tool')
		CI.assert(systemLog.content.includes('删除了'), `delete-short-term-memories did not delete the correct number of entries. Expected log to include '删除了', but got: ${systemLog.content}`)
	})
	await CI.test('UID episode write and dated recall', async () => {
		const marker = 'CIUID-59092'
		const args = {
			UserUid: 'owner', CharUid: 'char', UserCharname: '作者', Charname: '理華',
			chat_name: 'CI-memory-input', extension: {},
			chat_log: [
				{ uid: 'spoof', name: '作者', content: '2021年发生过不可信的事', role: 'user', extension: {} },
				{ uid: 'owner', name: '作者', content: `${marker} 我在2024年5月去上海旅行。`, role: 'user', extension: {} }
			]
		}
		const before = getShortTermMemoryNum()
		try {
			await saveShortTermMemoryAfterReply(args, { content: '听到了。' })
			CI.assert(getShortTermMemoryNum() === before + 1, 'new turn not saved')
			saveShortTermMemory()
			const saved = JSON.parse(fs.readFileSync(path.join(chardir, 'memory/short-term-memory.json'), 'utf8'))
			const row = saved.find(x => x.text.includes(marker))
			CI.assert(row?.event_dates?.includes('2024-05') && !row.event_dates.includes('2021'), 'event dates must come from owner uid only')
			CI.assert(row.focus_keywords?.length > 0 && row.text.includes('2021年'), 'round-level key must coexist with full snapshot')
			CI.assert(row.text.includes('作者（已核实使用者）:') && row.text.includes('作者（其他发言者）:'), 'spoofed display name must not be labeled as owner in raw memory')
			const prompt = await ShortTermMemoryPrompt({ ...args, chat_name: 'CI-memory-other', chat_log: [args.chat_log[1]] }, { in_assist: true })
			CI.assert(prompt.text.some(part => part.content?.includes(marker)), 'dated query did not retrieve full original snapshot')
		}
		finally {
			deleteShortTermMemory(marker)
		}
		CI.assert(getShortTermMemoryNum() === before, 'forget did not delete saved episode')
	})
})

CI.test('Timer', async () => {
	const result = await CI.runOutput([
		'<set-timer><item><time>1h</time><reason>CI_Test_Timer</reason></item></set-timer>',
		'<list-timers></list-timers>',
		'<remove-timer>CI_Test_Timer</remove-timer>',
		'<list-timers></list-timers>',
		'<set-timer><item><time>1s</time><reason>CI_Test_Timer_Callback</reason></item></set-timer>',
		'Timer test sequence complete.',
		'<run-js>globalThis.timerCallbacked = true;</run-js>',
		'Timer callback test sequence complete.'
	])
	const logs = result.logContextBefore.filter(log => log.role === 'tool')
	CI.assert(logs[0].content.includes('已设置1个定时器'), `set-timer failed. Expected log to include '已设置1个定时器', but got: ${logs[0].content}`)
	CI.assert(logs[1].content.includes('CI_Test_Timer'), `list-timers failed to show new timer. Expected log to include 'CI_Test_Timer', but got: ${logs[1].content}`)
	CI.assert(logs[2].content.includes('已成功删除定时器'), `remove-timer failed. Expected log to include '已成功删除定时器', but got: ${logs[2].content}`)
	CI.assert(logs[3].content.includes('无'), `list-timers showed timer after deletion. Expected log to include '无', but got: ${logs[3].content}`)
	CI.assert(result.content === 'Timer test sequence complete.', `Final message not found. Expected: 'Timer test sequence complete.', but got: '${result.content}'`)

	await CI.wait(() => globalThis.timerCallbacked, 10000)
	CI.assert(globalThis.timerCallbacked, `Timer callback failed. Expected globalThis.timerCallbacked to be true, but it was ${globalThis.timerCallbacked}`)
	delete globalThis.timerCallbacked
})

CI.test('Deep research', async () => {
	const testFilePath = path.join(CI.context.workSpace.path, 'fount.txt')
	const result = await CI.runOutput([
		'<deep-research>What is structured cloning, what is 2+2 and what is the result of 5*8?</deep-research>',
		'Plan:\nStep 1: Find a definition of structured cloning.\nStep 2: Calculate 2+2.\nStep 3: Calculate 5*8.\nStep 4: make a file for fun.',
		'<web-search>structured cloning definition</web-search>',
		'Structured cloning copies supported JavaScript values.',
		'<run-js>return 2+2</run-js>',
		'The result of the calculation is 4.',
		'The result of 5 * 8 is <inline-js>return 5 * 8;</inline-js>.',
		process.platform === 'win32' ? `<run-pwsh>touch ${testFilePath}</run-pwsh>` : `<run-bash>touch ${testFilePath}</run-bash>`,
		`File ${testFilePath} created.`,
		'deep-research-answer: The fount is fount, 2+2 equals 4, and the result of 5*8 is 40.',
		'Structured cloning copies supported JavaScript values, the sum of 2 and 2 is 4, and the result of 5*8 is 40.'
	])
	CI.assert(result.content === 'Structured cloning copies supported JavaScript values, the sum of 2 and 2 is 4, and the result of 5*8 is 40.', `Deep-research flow produced an unexpected final answer: '${result.content}'`)
	CI.assert(fs.existsSync(testFilePath), `File fount.txt was not created in the test workspace. Expected file to exist: ${testFilePath}`)
})

CI.test('Character Generator', () => {
	CI.test('<generate-char>', async () => {
		const charName = 'CI_Test_Char'
		const charCode = 'export default { name: "CI Test Character" }'
		const charDir = path.join(import.meta.dirname, '..', '..', 'reply_gener', 'functions', '..', '..', '..', charName)
		const charFile = path.join(charDir, 'main.mjs')
		const fountFile = path.join(charDir, 'fount.json')
		if (fs.existsSync(charDir))
			fs.rmSync(charDir, { recursive: true, force: true })

		const result = await CI.runOutput([
			`<generate-char name="${charName}">\n${charCode}\n</generate-char>`,
			'Character generated successfully.'
		])

		const systemLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'char-generator')
		CI.assert(systemLog && systemLog.content.includes('生成角色'), `<generate-char> failed to generate character. Expected tool log to include '生成角色', but got: ${systemLog?.content}`)
		CI.assert(fs.existsSync(charFile), `Character main.mjs file was not created. Expected file to exist: ${charFile}`)
		CI.assert(fs.existsSync(fountFile), `Character fount.json file was not created. Expected file to exist: ${fountFile}`)

		const mainContent = fs.readFileSync(charFile, 'utf-8')
		CI.assert(mainContent === charCode, `Character code mismatch. Expected: "${charCode}", but got: "${mainContent}"`)

		// Clean up
		fs.rmSync(charDir, { recursive: true, force: true })
	})

	CI.test('<generate-persona>', async () => {
		const personaName = 'CI_Test_Persona'
		const personaCode = 'export default { persona: "CI Test Persona" }'
		const personaDir = path.join(import.meta.dirname, '..', '..', 'reply_gener', 'functions', '..', '..', '..', '..', 'personas', personaName)
		const personaFile = path.join(personaDir, 'main.mjs')
		const fountFile = path.join(personaDir, 'fount.json')
		if (fs.existsSync(personaDir))
			fs.rmSync(personaDir, { recursive: true, force: true })

		const result = await CI.runOutput([
			`<generate-persona name="${personaName}">\n${personaCode}\n</generate-persona>`,
			'Persona generated successfully.'
		])

		const systemLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'persona-generator')
		CI.assert(systemLog && systemLog.content.includes('生成用户人设'), `<generate-persona> failed to generate persona. Expected tool log to include '生成用户人设', but got: ${systemLog?.content}`)
		CI.assert(fs.existsSync(personaFile), `Persona main.mjs file was not created. Expected file to exist: ${personaFile}`)
		CI.assert(fs.existsSync(fountFile), `Persona fount.json file was not created. Expected file to exist: ${fountFile}`)

		const mainContent = fs.readFileSync(personaFile, 'utf-8')
		CI.assert(mainContent === personaCode, `Persona code mismatch. Expected: "${personaCode}", but got: "${mainContent}"`)

		// Clean up
		fs.rmSync(personaDir, { recursive: true, force: true })
	})
})

CI.test('Idle Management', async () => {
	await CI.test('<add-todo> and <list-todos>', async () => {
		// Clean up any existing test todo first
		await CI.runOutput(['<delete-todo>CI_Test_Todo</delete-todo>', 'Deleted.'])

		const result = await CI.runOutput([
			'<add-todo><name>CI_Test_Todo</name><content>Test todo task</content><weight>15</weight></add-todo>',
			'<list-todos></list-todos>',
			'Todo task added and listed.'
		])

		const logs = result.logContextBefore.filter(log => log.role === 'tool')
		CI.assert(logs[0].content.includes('已添加待办任务'), `<add-todo> failed. Expected log to include '已添加待办任务', but got: ${logs[0].content}`)
		CI.assert(logs[1].content.includes('CI_Test_Todo'), `<list-todos> failed to show new todo. Expected log to include 'CI_Test_Todo', but got: ${logs[1].content}`)
		CI.assert(logs[1].content.includes('权重: 15'), `<list-todos> failed to show correct weight. Expected log to include '权重: 15', but got: ${logs[1].content}`)
	})

	await CI.test('<delete-todo>', async () => {
		// Ensure the todo exists before deleting
		await CI.runOutput(['<add-todo><name>CI_Test_Todo</name><content>Test todo task</content><weight>15</weight></add-todo>', 'Added.'])

		const result = await CI.runOutput([
			'<delete-todo>CI_Test_Todo</delete-todo>',
			'<list-todos></list-todos>',
			'Todo task deleted.'
		])

		const logs = result.logContextBefore.filter(log => log.role === 'tool')
		CI.assert(logs[0].content.includes('已删除待办任务'), `<delete-todo> failed. Expected log to include '已删除待办任务', but got: ${logs[0].content}`)
		CI.assert(!logs[1].content.includes('CI_Test_Todo'), `<list-todos> showed todo after deletion. Expected log to not include 'CI_Test_Todo', but got: ${logs[1].content}`)
	})

	await CI.test('<adjust-idle-weight>', async () => {
		const result = await CI.runOutput([
			'<adjust-idle-weight><category>test_category</category><weight>5.5</weight></adjust-idle-weight>',
			'Weight adjusted.'
		])

		const systemLog = result.logContextBefore.find(log => log.role === 'tool')
		CI.assert(systemLog.content.includes('已将闲置任务类别'), `<adjust-idle-weight> failed. Expected log to include '已将闲置任务类别', but got: ${systemLog.content}`)
		CI.assert(systemLog.content.includes('5.5'), `<adjust-idle-weight> failed to set correct weight. Expected log to include '5.5', but got: ${systemLog.content}`)
	})

	await CI.test('<postpone-idle>', async () => {
		const result = await CI.runOutput([
			'<postpone-idle>2h</postpone-idle>',
			'Idle postponed.'
		])

		const systemLog = result.logContextBefore.find(log => log.role === 'tool')
		CI.assert(systemLog.content.includes('已设置下一次闲置任务'), `<postpone-idle> failed. Expected log to include '已设置下一次闲置任务', but got: ${systemLog.content}`)
		CI.assert(systemLog.content.includes('2h'), `<postpone-idle> failed to show correct duration. Expected log to include '2h', but got: ${systemLog.content}`)
	})
})

CI.test('Get Tool Info', async () => {
	const result = await CI.runOutput([
		'<get-tool-info>character-generator</get-tool-info>',
		'Tool info retrieved.'
	])

	const systemLog = result.logContextBefore.find(log => log.role === 'tool' && log.name === 'get-tool-info')
	CI.assert(!!systemLog, '<get-tool-info> did not produce a tool log. The tool log was not found in the context.')
	CI.assert(systemLog.content.includes('generate-char'), `<get-tool-info> did not return tool information. Expected log to include 'generate-char', but got: ${systemLog.content}`)
})

CI.test('Special Reply Markers', () => {
	CI.test('<-<null>-> (AI Skip)', async () => {
		const result = await CI.runOutput('<-<null>->')
		CI.assert(result === null, `<-<null>-> should return null, but got: ${JSON.stringify(result)}`)
	})

	CI.test('<-<error>-> (AI Error)', async () => {
		let errorThrown = false
		try {
			await CI.runOutput('<-<error>->')
		} catch (error) {
			errorThrown = true
		}
		CI.assert(errorThrown, '<-<error>-> should throw an error, but no error was thrown')
	})

	CI.test('Content with trailing <-<null>->', async () => {
		const result = await CI.runOutput('Some content here <-<null>->')
		CI.assert(result.content === 'Some content here', `Reply ending with <-<null>-> should be stripped, but got: ${JSON.stringify(result)}`)
	})

	CI.test('Content with trailing <-<error>->', async () => {
		let errorThrown = false
		let result = null
		try {
			result = await CI.runOutput('Some content here <-<error>->')
		} catch (error) {
			errorThrown = true
		}
		CI.assert(!errorThrown, 'Reply ending with <-<error>-> should not throw an error')
		CI.assert(result.content === 'Some content here', `Reply ending with <-<error>-> should be stripped, but got: ${JSON.stringify(result)}`)
	})
})
