// Build and sign release metadata. The private key is never included in a release.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const signing=path.join(root,'.local','release-signing');
const privateFile=path.join(signing,'private.pem'),publicFile=path.join(root,'release-public-key.json');
if(process.argv.includes('--init-key')){
 fs.mkdirSync(signing,{recursive:true});
 if(fs.existsSync(privateFile)||fs.existsSync(publicFile))throw new Error('Signing key already exists; refusing to replace it.');
 const {privateKey,publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:3072});
 fs.writeFileSync(privateFile,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
 const jwk=publicKey.export({format:'jwk'});
 fs.writeFileSync(publicFile,JSON.stringify({modulus:Buffer.from(jwk.n,'base64url').toString('base64'),exponent:Buffer.from(jwk.e,'base64url').toString('base64')},null,2));
 console.log('Release signing key created locally. Back up the private key securely.');
}else{
 if(!/^\d+\.\d+\.\d+$/.test(config.version))throw new Error('Use a numeric major.minor.patch version.');
 const out=path.join(root,'.build','updates','v'+config.version);
 const python=process.env.NOZEOMICS_BUILD_PYTHON||path.join(root,'runtime','python','python.exe');
 const result=spawnSync(python,[path.join(root,'scripts','release_archives.py'),out],{cwd:root,windowsHide:true,stdio:'inherit'});
 if(result.status!==0)throw new Error('Release archive build failed.');
 const asset=async name=>{const file=path.join(out,name),hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return {url:`https://github.com/${config.repository}/releases/download/v${config.version}/${name}`,size:fs.statSync(file).size,sha256:hash.digest('hex')};};
 const payload={schema:1,version:config.version,runtime_id:config.runtime_id,launcher_protocol:config.launcher_protocol,data_schema:config.data_schema,channel:config.channel,published_at:new Date().toISOString(),app:await asset('NozeOmics-app.zip'),full:await asset('NozeOmics-runtime.zip')};
 const bytes=Buffer.from(JSON.stringify(payload));
 const signature=crypto.sign('RSA-SHA256',bytes,fs.readFileSync(privateFile)).toString('base64');
 fs.writeFileSync(path.join(out,'latest.json'),JSON.stringify({payload:bytes.toString('base64'),signature},null,2));
 console.log('Signed release ready:',out);
}
