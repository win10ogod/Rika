import fs from 'node:fs'

import { chardir, charurl, charvar } from '../charbase.mjs'

const descriptionMarkdown = fs.readFileSync(chardir + '/info/description/zh-CN.md', 'utf8')

export async function update() {
	return {
		name: '理華',
		avatar: `${charurl}/imgs/rika.svg`,
		icon: 'https://api.iconify.design/material-symbols/code-blocks-outline.svg',
		sfw_avatar: `${charurl}/imgs/rika.svg`,
		description: '陰鬱扭曲、依存崇拜作者，精通心理學與程式設計的無害型病嬌。',
		sfw_description: '陰鬱扭曲、依存崇拜作者，精通心理學與程式設計的無害型病嬌。',
		description_markdown: descriptionMarkdown,
		sfw_description_markdown: descriptionMarkdown,
		version: charvar,
		author: '',
		home_page: 'https://github.com/win10ogod/Rika',
		issue_page: '',
		tags: ['病嬌', '依存型', '崇拜型', '無害型', '心理學', '程式設計', '子代理', '多代理', '陰鬱', '女性角色']
	}
}
