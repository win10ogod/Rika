import { unlockAchievement } from '../../scripts/achievements.mjs'
import { discoverSkills, findExplicitSkillNames, readSkill, readSkillResource } from '../../scripts/skills.mjs'

function getAttribute(attrs, name) {
	const match = String(attrs || '').match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
	return match ? (match[1] ?? match[2] ?? '') : undefined
}

/** @type {import('../../../../../../../src/decl/PluginAPI.ts').ReplyHandler_t} */
export async function SkillsHandler(result, args) {
	const catalog = discoverSkills()
	const explicitNames = findExplicitSkillNames(args, catalog)
	result.extension.skills = [...new Set([...(result.extension.skills || []), ...explicitNames])]

	const activations = [...String(result.content || '').matchAll(/<activate-skill>(?<name>[\s\S]*?)<\/activate-skill>/gi)]
	const resources = [...String(result.content || '').matchAll(/<read-skill-resource\b(?<attrs>[^>]*)>(?<path>[\s\S]*?)<\/read-skill-resource>/gi)]
	if (!activations.length && !resources.length) return false

	const calls = [
		...activations.map(match => ({ index: match.index, raw: match[0] })),
		...resources.map(match => ({ index: match.index, raw: match[0] })),
	].sort((a, b) => a.index - b.index)
	args.AddLongTimeLog({ name: '理華', role: 'char', content: calls.map(call => call.raw).join('\n'), files: [] })

	const active = new Set(result.extension.skills)
	for (const match of activations) {
		const name = match.groups?.name?.trim?.() || ''
		try {
			if (active.has(name)) {
				args.AddLongTimeLog({ name: `skill:${name || 'unknown'}`, role: 'tool', content: `Skill「${name}」已經啟用；請直接使用現有指示，不要再次啟用。`, files: [] })
				continue
			}
			const skill = readSkill(name, catalog)
			active.add(skill.name)
			result.extension.skills = [...active]
			args.AddLongTimeLog({
				name: `skill:${skill.name}`,
				role: 'tool',
				content: `已啟用角色原生 Skill「${skill.name}」。\n路徑：${skill.path}\n\n<skill-instructions>\n${skill.content}\n</skill-instructions>`,
				files: []
			})
			await unlockAchievement('use_skill')
		}
		catch (error) {
			args.AddLongTimeLog({ name: `skill:${name || 'unknown'}`, role: 'tool', content: `Skill 啟用失敗：${error.message || error}`, files: [] })
		}
	}

	for (const match of resources) {
		const name = getAttribute(match.groups?.attrs, 'skill')?.trim?.() || ''
		const relativePath = match.groups?.path?.trim?.() || ''
		try {
			if (!active.has(name)) throw new Error(`Skill「${name}」尚未啟用；請先使用 <activate-skill>`)
			const resource = readSkillResource(name, relativePath, catalog)
			args.AddLongTimeLog({
				name: `skill-resource:${name}`,
				role: 'tool',
				content: `已讀取 Skill「${name}」的文字資源。\n路徑：${resource.path}\n\n<skill-resource>\n${resource.content}\n</skill-resource>`,
				files: []
			})
		}
		catch (error) {
			args.AddLongTimeLog({ name: `skill-resource:${name || 'unknown'}`, role: 'tool', content: `Skill 資源讀取失敗：${error.message || error}`, files: [] })
		}
	}

	return true
}
