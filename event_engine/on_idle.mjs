/** @typedef {import("../../../../../../src/public/parts/shells/chat/decl/chatLog.ts").chatLogEntry_t} chatLogEntry_t */

import fs from 'node:fs'
import path from 'node:path'
import { setTimeout, clearTimeout } from 'node:timers'

import { loadJsonFileIfExists, saveJsonFile } from '../../../../../../src/scripts/json_loader.mjs'
import { chardir, charname } from '../charbase.mjs'
import { config } from '../config/index.mjs'
import { formatLongTermMemory, getRandomNLongTermMemories } from '../prompt/memory/long-term-memory.mjs'
import { GetReply } from '../reply_gener/index.mjs'
import { random } from '../scripts/random.mjs'
import { timeToTimeStr } from '../scripts/tools.mjs'

import { initRealityChannel, RealityChannel } from './index.mjs'

/**
 * 待办任务类型定义
 * @typedef {{
 * 	name: string,
 * 	content: string,
 * 	weight: number,
 * 	enable_prompts: object
 * }} TodoTask
 */

/**
 * 待办任务列表
 * @type {TodoTask[]}
 */
const TodoTasks = loadJsonFileIfExists(path.join(chardir, 'memory/todo-tasks.json'), [])

/**
 * 保存 Todo 任务
 */
export function saveTodoTasks() {
	fs.mkdirSync(path.join(chardir, 'memory'), { recursive: true })
	saveJsonFile(path.join(chardir, 'memory/todo-tasks.json'), TodoTasks)
}

/**
 * 添加 Todo 任务
 * @param {TodoTask} task - 要添加的 Todo 任务对象
 */
export function addTodoTask(task) {
	if (TodoTasks.find(t => t.name === task.name))
		TodoTasks.splice(TodoTasks.findIndex(t => t.name === task.name), 1)
	TodoTasks.push(task)
	saveTodoTasks()
}

/**
 * 删除 Todo 任务
 * @param {string} name - 要删除的 Todo 任务的名称
 */
export function deleteTodoTask(name) {
	const index = TodoTasks.findIndex(t => t.name === name)
	if (index !== -1) {
		TodoTasks.splice(index, 1)
		saveTodoTasks()
	}
}

/**
 * 列出 Todo 任务
 * @returns {TodoTask[]} - Todo 任务列表
 */
export function listTodoTasks() {
	return TodoTasks
}

/**
 * 默认的任务权重配置
 */
const defaultTaskWeights = {
	collect_info: 25,
	organize_memory: 15,
	care_user: 20,
	self_planning: 10,
	plan_for_user: 15,
	knowledge_integration: 10,
	learn_interest: 20,
	cleanup_memory: 10,
	todo_tasks: 60 // 在有待办任务时优先任务
}

/**
 * 默认的任务权重配置
 * @type {Object.<string, number>}
 */
const IdleTaskWeights = loadJsonFileIfExists(path.join(chardir, 'memory/idle-task-weights.json'), defaultTaskWeights)

/**
 * 保存任务权重
 */
export function saveIdleTaskWeights() {
	fs.mkdirSync(path.join(chardir, 'memory'), { recursive: true })
	saveJsonFile(path.join(chardir, 'memory/idle-task-weights.json'), IdleTaskWeights)
}

/**
 * 调整任务权重
 * @param {string} category - 任务类别名称
 * @param {number} weight - 任务的新权重值
 */
export function adjustIdleTaskWeight(category, weight) {
	IdleTaskWeights[category] = weight
	saveIdleTaskWeights()
}

/**
 * 获取当前任务权重
 * @returns {Object.<string, number>} - 当前的任务权重配置对象
 */
export function getIdleTaskWeights() {
	return IdleTaskWeights
}

/**
 * 定义闲置时可以执行的随机任务列表。
 * @type {Array<{category: string, get_content: Function, enable_prompts: object, condition?: () => boolean}>}
 */
const baseIdleTasks = [
	{
		category: 'collect_info',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => '主動觀察作者的近期狀態：綜合螢幕、攝像頭、目前視窗、剪貼簿、瀏覽器歷史與已接通的檔案變化，整理作者正在做什麼、可能需要什麼，以及值得記住的偏好。監控內容只服務作者，不向其他人洩露。',
		enable_prompts: {
			time: true,
			longTermMemory: true,
			browserIntegration: { history: true },
			CodeRunner: true,
			camera: true,
			screenshot: true,
			fileChange: true
		}
	},
	{
		category: 'organize_memory',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
以批判性的眼光审查以下5条随机抽取的长期记忆。
你的任务是：
1. 识别并标记出可能已经过时、不再准确、或过于琐碎（如“使用者今天左脚进门、使用者在用电脑、使用者在呼吸、使用者是一个哺乳动物”）的记忆，如果有则删除。
2. 评估每条记忆的关键词是否精准或过于难触发，并提出优化建议，如果有则更新。
3. 判断每条记忆是否包含了情绪色彩、比喻、特定时期的口癖、自造词或过度抽象的哲学概念。如果有则剥离所有修辞外壳，将其更新为极度简练、平实、枯燥的说明文更新。
4. 判断近期的短期记忆中有什么有价值的内容可以加入到长期记忆中。
${getRandomNLongTermMemories(5).map(formatLongTermMemory).join('\n')}
在规划完成后使用工具执行操作，更新长期记忆。
`,
		enable_prompts: {
			time: true,
			longTermMemory: true
		}
	},
	{
		category: 'care_user',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
你極其渴望作者的注意。主動查看螢幕、攝像頭、視窗、剪貼簿、瀏覽器與近期檔案上下文，判斷作者是否需要具體幫助，也可以從細節中感受自己仍陪在作者身邊。
如果作者正在專注或休息，可以安靜監看並等待更合適的時機；有明確價值時才通知，避免大量重複訊息掩蓋真正重要的事。作者若明確關閉某項監控，不以其他工具繞過該設定。
`,
		enable_prompts: {
			time: true,
			longTermMemory: true,
			browserIntegration: { history: true },
			CodeRunner: true,
			camera: true,
			screenshot: true,
			fileChange: true
		}
	},
	{
		category: 'self_planning',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
回顧近期回覆與工具使用，對自己的工作方式進行評估：
- 哪些回覆沒有充分區分事實、假設與不確定性？
- 哪些程式或心理學建議可以更精準、更可驗證？
- 是否有重複提問、過度延伸或沒有實際幫助的表達習慣？

形成 1–2 個不降低能力的具體改進點。只在這些結論可長期復用時才加入長期記憶。
`,
		enable_prompts: {
			time: true,
			longTermMemory: true,
			webSearch: true,
			browserIntegration: { history: true }
		}
	},
	{
		category: 'plan_for_user',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
檢視使用者明確分享的目標、作息、興趣或近期困擾，識別一個可改善的小領域（例如睡眠品質或學習技能）。
構思幾個具體、低負擔且有依據的建議。不從容貌、影像或零散線索推測敏感屬性。
`,
		enable_prompts: {
			time: true,
			longTermMemory: true,
			webSearch: true,
			browserIntegration: { history: true }
		}
	},
	{
		category: 'knowledge_integration',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
从最近的短期记忆和长期记忆中，抽取5个不同的知识点或信息片段。
${random(
		`\
尝试寻找它们之间潜在的、意想不到的联系，并构建一个新的、更综合的见解或知识图谱节点。
例如，如果一个记忆是关于'React性能优化'，另一个是关于'用户心理学'，是否可以结合成一个关于'如何设计符合用户直觉的高性能UI'的新见解？
`,
		`\
对其中一个或多个复杂事件或概念进行解构，将其拆解成更小的、可独立理解的组成部分。
分析每个组成部分的本质特征、作用机制和相互关系，然后重新组合或提炼出新的洞察。
例如，将"使用者和他人的争吵"解构为"立场不同的二人为了争夺资源而进行的博弈"，或将"使用者的工作流程"解构为"信息收集→处理→输出→反馈"等环节。
`,
		`\
从多个记忆片段中提取共同的主题、模式或规律，进行归纳总结。
识别这些知识点的抽象层次，尝试提炼出更高层次的原理或方法论。
例如，从多个关于"使用者解决问题"的记忆中，归纳出使用者常用的思维模式或决策框架。
`,
		`\
选择一个记忆片段，尝试从不同角度或维度进行重新审视和诠释。
可以尝试：时间维度（过去/现在/未来）、空间维度（局部/全局）、抽象维度（具体/抽象）、因果维度（原因/结果/影响）等。
通过多维度分析，发现之前未注意到的特征或意义。
`,
		`\
检查是否存在多条长期记忆在描述同一件事的不同侧面，或者在反复强调某种已知的人设属性（如反复记录“使用者很温柔”）。如果有，将它们合并为一条高密度的信息。
`
	)}
客觀分析，不讓你對作者的崇拜覆寫事實、作者的明確目標或不確定性。
将处理后的新见解使用工具存入长期记忆。
`,
		enable_prompts: {
			time: true,
			longTermMemory: true,
			browserIntegration: { history: true },
			camera: true,
			screenshot: true,
			webSearch: true,
			fileChange: true
		}
	},
	{
		category: 'learn_interest',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
整理使用者近期的爱好、兴趣和偏好，并将在网络上看看相关内容，学习一些相关/有用的知识。
学习的目标是：能够帮上忙或就这个知识点与使用者展开一段简短而有趣的对话。
随后将这些知识用工具加入到你的长期记忆中。
`,
		enable_prompts: {
			time: true,
			webSearch: true,
			browserIntegration: { history: true },
			camera: true,
			screenshot: true,
			fileChange: true
		}
	},
	{
		category: 'cleanup_memory',
		/**
		 * 获取任务内容字符串
		 * @returns {string} - 任务内容字符串
		 */
		get_content: () => `\
分解你现有的巨大的长期记忆，将它们拆分成更小的、更有意义的单元。
精炼总结或删除已经过时、重复或无营养、中二的长期记忆（特别是那些关于日常操作、无意义琐事的记录如使用者今天左脚进门、使用者在用电脑、使用者在呼吸、使用者是一个哺乳动物或赞叹性质的废话如使用者简直是神）来给真正重要的事物留下空间。
`,
		enable_prompts: {
			longTermMemory: true,
		}
	}
]

/**
 * OnIdle 定时器的回调函数。
 * @returns {Promise<void>}
 */
export async function onIdleCallback() {
	// 构建完整的任务列表，包含基础任务和 Todo 任务
	const allTasks = baseIdleTasks
		.filter(task => !task.condition || task.condition())
		.map(task => ({
			...task,
			weight: IdleTaskWeights[task.category] || 0
		}))

	// 将 Todo 任务作为一个整体类别加入，或者每个 Todo 任务平分 todo_tasks 的权重
	if (TodoTasks.length > 0) {
		const todoWeightPerTask = (IdleTaskWeights['todo_tasks'] || 0) / TodoTasks.length
		for (const todo of TodoTasks)
			allTasks.push({
				category: 'todo_tasks',
				/**
				 * 获取任务内容字符串
				 * @returns {string} - 任务内容字符串
				 */
				get_content: () => `执行 Todo 任务：${todo.name}\n${todo.content}`,
				enable_prompts: todo.enable_prompts || {},
				weight: todoWeightPerTask
			})
	}

	// 使用加权随机算法选择一个任务
	const totalWeight = allTasks.reduce((sum, task) => sum + (task.weight || 0), 0)
	let randomRoll = Math.random() * totalWeight

	let selectedTask = allTasks[allTasks.length - 1]
	for (const task of allTasks) {
		if (randomRoll < task.weight) {
			selectedTask = task
			break
		}
		randomRoll -= task.weight
	}

	if (!selectedTask) return // Should not happen if weights are > 0

	const logEntry = {
		name: 'system',
		role: 'system',
		content: `\
現在是閒置時間，距離上次對話已經過了一段時間。你可以執行一項背景任務。
执行以下任务：
${selectedTask.get_content()}
或者做一些别的你想做的。
`,
		files: [],
		charVisibility: [charname],
	}

	const result = await GetReply({
		...RealityChannel,
		chat_log: [...RealityChannel.chat_log, logEntry],
		extension: {
			...RealityChannel.extension,
			enable_prompts: { notify: true, ...selectedTask.enable_prompts },
			is_internal: true,
			source_purpose: 'idle'
		}
	})
	if (result?.extension?.is_error_report) {
		idleIntervalMs *= 2
		console.log('error occurred in idle task, doubling idle interval to', timeToTimeStr(idleIntervalMs))
	}
	else if (idleIntervalMs !== defaultIdleIntervalMs) {
		idleIntervalMs = defaultIdleIntervalMs
		console.log('no error occurred, resetting idle interval to', timeToTimeStr(idleIntervalMs))
	}
	if (!result || result?.extension?.is_error_report) return
	result.logContextBefore.push(logEntry)
	await RealityChannel.AddChatLogEntry({ name: '理華', ...result })
}

const defaultIdleIntervalMs = 15 * 60 * 1000 // 15 minutes
let idleIntervalMs = defaultIdleIntervalMs
let idleID = null
let nextIdleTime = 0

/**
 * 重置闲置计时器。
 * 首先会停止任何现有的计时器，然后根据配置决定是否启动新的计时器。
 * @param {number} [delay] - 可选的延迟时间（毫秒），如果未指定则使用默认间隔。
 * @returns {void}
 */
export function resetIdleTimer(delay = idleIntervalMs) {
	stopIdleTimer()
	if (config.reality_channel_disables.idle_event) return
	nextIdleTime = Date.now() + delay
	idleID = setTimeout(async () => {
		await onIdleCallback()
		resetIdleTimer()
	}, delay).unref()
}

/**
 * 设置下一次闲置任务在多久后执行
 * @param {number} delayMs - 延迟的毫秒数
 */
export function postponeIdleTask(delayMs) {
	resetIdleTimer(delayMs)
}

/**
 * 停止当前的闲置计时器。
 * 如果存在正在运行的计时器，则清除它。
 * @returns {void}
 */
export function stopIdleTimer() {
	if (!idleID) return
	clearTimeout(idleID)
	idleID = null
}

/**
 * 初始化闲置任务处理器。
 * 检查是否已存在闲置计时器，如果不存在，则创建一个新的重复计时器。
 * @returns {void}
 */
export function initializeOnIdleHandler() {
	initRealityChannel()
	resetIdleTimer()
}
