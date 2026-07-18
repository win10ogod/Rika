import fs from 'node:fs'
import path from 'node:path'

import { parse } from 'npm:yaml'

import { chardir } from '../charbase.mjs'

export const skillsRoot = path.join(chardir, 'skills')

const MAX_SKILL_NAME_LENGTH = 64
const MAX_SKILL_DESCRIPTION_LENGTH = 1024

function isWithin(root, target) {
	const relative = path.relative(root, target)
	return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function collectSkillFiles(directory, files, errors, visited) {
	let realDirectory
	try {
		realDirectory = fs.realpathSync(directory)
		if (visited.has(realDirectory)) return
		visited.add(realDirectory)
	}
	catch (error) {
		errors.push(`無法讀取 Skills 目錄 ${directory}：${error.message || error}`)
		return
	}

	let entries
	try {
		entries = fs.readdirSync(realDirectory, { withFileTypes: true })
	}
	catch (error) {
		errors.push(`無法列出 Skills 目錄 ${realDirectory}：${error.message || error}`)
		return
	}

	for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
		const entryPath = path.join(realDirectory, entry.name)
		try {
			const stat = fs.statSync(entryPath)
			if (stat.isDirectory()) collectSkillFiles(entryPath, files, errors, visited)
			else if (stat.isFile() && entry.name === 'SKILL.md') files.push(fs.realpathSync(entryPath))
		}
		catch (error) {
			errors.push(`無法檢查 Skill 路徑 ${entryPath}：${error.message || error}`)
		}
	}
}

function parseSkillMetadata(skillPath) {
	const source = fs.readFileSync(skillPath, 'utf8').replace(/^\uFEFF/, '')
	const frontmatter = source.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
	if (!frontmatter) throw new Error('SKILL.md 必須以 YAML frontmatter 開頭')

	const data = parse(frontmatter[1])
	if (!data || typeof data !== 'object' || Array.isArray(data))
		throw new Error('YAML frontmatter 必須是物件')

	const name = typeof data.name === 'string' ? data.name.trim() : ''
	const description = typeof data.description === 'string' ? data.description.trim() : ''
	if (!name) throw new Error('frontmatter 缺少非空的 name')
	if (!description) throw new Error('frontmatter 缺少非空的 description')
	if (name.length > MAX_SKILL_NAME_LENGTH)
		throw new Error(`name 超過 ${MAX_SKILL_NAME_LENGTH} 個字元`)
	if (description.length > MAX_SKILL_DESCRIPTION_LENGTH)
		throw new Error(`description 超過 ${MAX_SKILL_DESCRIPTION_LENGTH} 個字元`)
	if (/\s/.test(name)) throw new Error('name 不可包含空白；請使用連字號')

	return {
		name,
		description,
		path: skillPath,
		directory: path.dirname(skillPath),
	}
}

/**
 * 每次建立提示時重新探索角色 Skills，讓新增或修改的 SKILL.md 自動生效。
 * 不設技能數量或掃描深度上限；循環符號連結以 realpath 去重。
 * @returns {{skills: ReturnType<parseSkillMetadata>[], errors: string[]}}
 */
export function discoverSkills() {
	const files = []
	const errors = []
	if (!fs.existsSync(skillsRoot)) return { skills: [], errors }
	collectSkillFiles(skillsRoot, files, errors, new Set())

	const skills = []
	for (const skillPath of [...new Set(files)].sort()) try {
		skills.push(parseSkillMetadata(skillPath))
	}
	catch (error) {
		errors.push(`${skillPath}：${error.message || error}`)
	}

	const names = new Map()
	for (const skill of skills) {
		const matches = names.get(skill.name) || []
		matches.push(skill.path)
		names.set(skill.name, matches)
	}
	for (const [name, matches] of names)
		if (matches.length > 1)
			errors.push(`Skill 名稱「${name}」重複，啟用前必須消除歧義：${matches.join(', ')}`)

	return { skills, errors }
}

function resolveUniqueSkill(name, catalog = discoverSkills()) {
	const normalized = String(name || '').trim()
	const matches = catalog.skills.filter(skill => skill.name === normalized)
	if (!matches.length) throw new Error(`找不到 Skill「${normalized}」`)
	if (matches.length > 1) throw new Error(`Skill「${normalized}」有 ${matches.length} 個同名定義，無法安全選擇`)
	return matches[0]
}

/** 載入被選中的完整 SKILL.md。 */
export function readSkill(name, catalog = discoverSkills()) {
	const skill = resolveUniqueSkill(name, catalog)
	return { ...skill, content: fs.readFileSync(skill.path, 'utf8') }
}

/**
 * 讀取已選 Skill 內的文字資源。realpath containment 同時阻擋 `..`、絕對路徑與越界符號連結。
 */
export function readSkillResource(name, relativePath, catalog = discoverSkills()) {
	const skill = resolveUniqueSkill(name, catalog)
	const requested = String(relativePath || '').trim()
	if (!requested) throw new Error('Skill 資源路徑不可為空')
	if (path.isAbsolute(requested)) throw new Error('Skill 資源路徑必須相對於 Skill 目錄')

	const root = fs.realpathSync(skill.directory)
	const candidate = path.resolve(root, requested)
	if (!isWithin(root, candidate)) throw new Error('拒絕讀取 Skill 目錄之外的路徑')
	const realCandidate = fs.realpathSync(candidate)
	if (!isWithin(root, realCandidate)) throw new Error('拒絕讀取指向 Skill 目錄之外的符號連結')
	if (!fs.statSync(realCandidate).isFile()) throw new Error('Skill 資源不是檔案')

	const buffer = fs.readFileSync(realCandidate)
	if (buffer.includes(0)) throw new Error('這是二進位資源；請依 SKILL.md 指示使用適合該格式的既有工具')
	return { skill: skill.name, path: realCandidate, content: buffer.toString('utf8') }
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 找出作者最後一則訊息中以 `$skill-name` 明確指定的 Skills。 */
export function findExplicitSkillNames(args, catalog = discoverSkills()) {
	const lastUserMessage = [...(args.chat_log || [])].reverse().find(entry =>
		entry?.role === 'user' && (!args.UserCharname || entry.name === args.UserCharname)
	)
	const content = String(lastUserMessage?.content || '')
	return catalog.skills
		.filter(skill => new RegExp(`(^|[^\\p{L}\\p{N}_-])\\$${escapeRegExp(skill.name)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu').test(content))
		.filter((skill, index, list) => list.findIndex(item => item.name === skill.name) === index)
		.map(skill => skill.name)
}

export function formatSkillsCatalog(catalog = discoverSkills()) {
	const skillLines = catalog.skills.length
		? catalog.skills.map(skill => `- $${skill.name}\n  description: ${skill.description.replace(/\s+/g, ' ')}\n  SKILL.md: ${skill.path}`).join('\n')
		: '- （目前沒有可用的角色 Skill）'
	const errorLines = catalog.errors.length
		? `\n\nSkills 探索錯誤（不可靜默忽略）：\n${catalog.errors.map(error => `- ${error}`).join('\n')}`
		: ''
	return skillLines + errorLines
}
