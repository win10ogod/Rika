import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'

import JSZip from 'npm:jszip'

const characterRoot = path.resolve(import.meta.dirname, '..', '..')
const fountJson = JSON.parse(await fsp.readFile(path.join(characterRoot, 'fount.json'), 'utf8'))
const dataFiles = fountJson.data_files || []
const excludedTopLevel = new Set(['.git', '.ci-workspaces', ...dataFiles])
const zip = new JSZip()

/**
 * @param {string} directory 目前要收集的目錄。
 * @param {string} relativeDirectory ZIP 內的相對目錄。
 * @returns {Promise<void>}
 */
async function addDirectory(directory, relativeDirectory = '') {
	for (const entry of (await fsp.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
		if (!relativeDirectory && excludedTopLevel.has(entry.name)) continue
		const absolutePath = path.join(directory, entry.name)
		const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
		const stat = await fsp.lstat(absolutePath)
		if (stat.isSymbolicLink()) throw new Error(`拒絕將符號連結寫入角色安裝包：${relativePath}`)
		if (entry.isDirectory()) await addDirectory(absolutePath, relativePath)
		else if (entry.isFile()) zip.file(relativePath, await fsp.readFile(absolutePath))
	}
}

await addDirectory(characterRoot)
const buffer = await zip.generateAsync({
	type: 'nodebuffer',
	compression: 'DEFLATE',
	compressionOptions: { level: 9 },
	platform: 'DOS'
})

const inspected = await JSZip.loadAsync(buffer)
if (!inspected.file('fount.json')) throw new Error('ZIP 根目錄缺少 fount.json')
for (const excluded of excludedTopLevel)
	if (Object.keys(inspected.files).some(file => file === excluded || file.startsWith(excluded + '/')))
		throw new Error(`ZIP 包含不應匯出的路徑：${excluded}`)

const outputDirectory = path.join(characterRoot, 'dist')
const outputPath = path.join(outputDirectory, 'Rika-fount.zip')
const checksumPath = outputPath + '.sha256'
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
await fsp.mkdir(outputDirectory, { recursive: true })
await fsp.writeFile(outputPath, buffer)
await fsp.writeFile(checksumPath, `${sha256}  ${path.basename(outputPath)}\n`, 'utf8')

for (const obsolete of ['Rika-fount.7z', 'Rika-fount.7z.sha256'])
	await fsp.rm(path.join(outputDirectory, obsolete), { force: true })

console.log(JSON.stringify({
	outputPath,
	checksumPath,
	format: 'zip',
	bytes: buffer.length,
	sha256,
	fileCount: Object.values(inspected.files).filter(file => !file.dir).length
}, null, 2))
