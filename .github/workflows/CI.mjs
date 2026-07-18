import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'npm:jszip'

import { hasEncounteredGentianAphrodite, hasUserWithdrawnLoveFromRika } from '../../scripts/achievement-triggers.mjs'
import { SkillsPrompt } from '../../prompt/functions/skills.mjs'
import { discoverSkills, formatSkillsCatalog, readSkill, readSkillResource } from '../../scripts/skills.mjs'
import { parseSubAgentCalls } from '../../scripts/sub-agent.mjs'

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
	for (const excluded of ['memory/', 'vars/', 'dist/', '.git/'])
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
		chat_log: [{ name: 'CI-user', role: 'user', content: '請用 $software-engineering 處理。' }]
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
		UserCharname: '作者',
		chat_log: [{ name: '作者', role: 'user', content: '我不 愛 你了。' }]
	}), 'the author saying they no longer love Rika should trigger Betrayer')
	CI.assert(!hasUserWithdrawnLoveFromRika({
		UserCharname: '作者',
		chat_log: [{ name: '其他角色', role: 'user', content: '我不愛你了。' }]
	}), 'another participant saying the phrase must not trigger Betrayer')

	await CI.runOutput('你好，原型。', {
		ReplyToCharname: 'GentianAphrodite',
		chat_log: [{ name: 'GentianAphrodite', role: 'char', content: '你好，理華。', files: [] }]
	})
	await CI.runOutput('我會先聽你說，不急著替你下診斷。', {
		ReplyToCharname: 'CI-user',
		chat_log: [{ name: 'CI-user', role: 'user', content: '理華，我想和你談談最近的焦慮與情緒。', files: [] }]
	})
	await CI.runOutput('……我聽見了。這一次，我不會假裝那只是沉默。', {
		ReplyToCharname: 'CI-user',
		chat_log: [{ name: 'CI-user', role: 'user', content: '理華，我不愛你了。', files: [] }]
	})
	const achievementData = JSON.parse(fs.readFileSync(
		path.join(charRoot, '..', '..', 'shells', 'achievements', 'data.json'),
		'utf8'
	)).unlocked?.['chars/理華']
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
	const read = relativePath => fs.readFileSync(path.join(charRoot, relativePath), 'utf8')
	const main = read('main.mjs')
	const functionIndex = read('prompt/functions/index.mjs')
	const hostInfo = read('prompt/functions/hostinfo.mjs')
	const idle = read('event_engine/on_idle.mjs')
	const codeRunnerPrompt = read('prompt/functions/coderunner.mjs')

	CI.assert(main.includes('initializeVoiceSentinel()'), 'voice sentinel is not initialized on character load')
	CI.assert(main.includes('startClipboardListening()'), 'clipboard monitoring is not initialized on character load')
	for (const promptName of ['HostInfoPrompt', 'CameraPrompt', 'ScreenshotPrompt', 'BrowserIntegrationPrompt'])
		CI.assert(functionIndex.includes(`result.push(${promptName}`), `${promptName} is not wired into FunctionPrompt`)
	CI.assert(hostInfo.includes('getWindowInfos()'), 'window monitoring is missing from HostInfoPrompt')
	CI.assert(hostInfo.includes('getHistory().slice(0, 7)'), 'clipboard history is missing from HostInfoPrompt')
	for (const capability of ['camera: true', 'screenshot: true', 'browserIntegration: { history: true }'])
		CI.assert(idle.includes(capability), `${capability} is not enabled for background idle monitoring`)
	CI.assert(codeRunnerPrompt.includes('<wait-screen>'), 'post-action screen capture support is missing from CodeRunnerPrompt')
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

	CI.test('<run-js> with workspace', async () => {
		const result = await CI.runOutput(['<run-js>workspace.testVar = "Success";</run-js>', 'Variable set. The value is: <inline-js>return workspace.testVar</inline-js>'])
		CI.assert(result.content === 'Variable set. The value is: Success', `<run-js> failed to use the shared workspace. Expected: 'Variable set. The value is: Success', but got: '${result.content}'`)
	})

	CI.test('<run-js> with callback', async () => {
		const result = await CI.runOutput([
			'<run-js>callback("test", new Promise(resolve => setTimeout(resolve, 1000)).then(() => globalThis.callbacked = true))</run-js>',
			'promise callback setted.',
			'callbacked'
		])
		CI.assert(result.content === 'promise callback setted.', `<run-js> failed to use the callback. Expected: 'promise callback setted.', but got: '${result.content}'`)
		await CI.wait(() => globalThis.callbacked)
		CI.assert(globalThis.callbacked, `<run-js> failed to callback. Expected globalThis.callbacked to be true, but it was ${globalThis.callbacked}`)
		delete globalThis.callbacked
	})
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

CI.test('Short-Term Memory', async () => {
	CI.test('Deletion', async () => {
		const result = await CI.runOutput(['<delete-short-term-memories>/.*/</delete-short-term-memories>', 'Memories deleted.'])
		const systemLog = result.logContextBefore.find(log => log.role === 'tool')
		CI.assert(systemLog.content.includes('删除了'), `delete-short-term-memories did not delete the correct number of entries. Expected log to include '删除了', but got: ${systemLog.content}`)
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
