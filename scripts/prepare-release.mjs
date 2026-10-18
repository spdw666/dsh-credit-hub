import {readFile,writeFile} from 'node:fs/promises';
// Run only when preparing a real marketplace release; this script does not push.
const repository=process.argv[2];if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository??''))throw Error('Usage: node scripts/prepare-release.mjs OWNER/REPO');
const file=new URL('../package.json',import.meta.url),pkg=JSON.parse(await readFile(file,'utf8'));
pkg.repository={type:'git',url:`https://github.com/${repository}.git`};pkg.homepage=`https://github.com/${repository}#readme`;
await writeFile(file,JSON.stringify(pkg,null,2)+'\n');await writeFile(new URL('../release.json',import.meta.url),JSON.stringify({schemaVersion:1,name:pkg.name,version:pkg.version,releaseUrl:`https://github.com/${repository}/releases/tag/v${pkg.version}`,publishedAt:new Date().toISOString()},null,2)+'\n');console.log('RELEASE_METADATA_READY version='+pkg.version+'; networkWrites=0');
