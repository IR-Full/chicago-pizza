const fs = require('fs');
const yaml = require('../server/node_modules/js-yaml');
const base = yaml.load(fs.readFileSync('docker-compose.yml', 'utf8'), { schema: yaml.YAML11_SCHEMA });
const prod = {services: {}, volumes: Object.fromEntries(['postgres_data','redis_data','rabbitmq_data'].map(x=>[x,null])), networks: {default:{}, 'dokploy-network':{external:true}}};
for (const [name, original] of Object.entries(base.services)) {
 if (['mailhog','certbot'].includes(name)) continue;
 const s = structuredClone(original); delete s.ports; delete s.profiles;
 if (['auth','products','orders','notifications','support','gateway','migrate'].includes(name)) {delete s.build;s.image='${SERVER_IMAGE:?immutable server image required}';}
 if (name==='client') {delete s.build;s.image='${CLIENT_IMAGE:?immutable client image required}';}
 const env=s.environment || {};
 for(const [key,val] of Object.entries(env)) if(typeof val==='string') env[key]=val.replaceAll('${POSTGRES_PASSWORD:-pizza}','${POSTGRES_PASSWORD:?required}').replaceAll('${REDIS_PASSWORD:-pizza}','${REDIS_PASSWORD:?required}').replaceAll('${RABBITMQ_PASSWORD:-pizza}','${RABBITMQ_PASSWORD:?required}').replaceAll('${CLIENT_URL:-http://localhost}','https://${DOMAIN:?required}');
 if(env.DATABASE_URL) env.DEPLOYMENT_MODE='public';
 if(name==='notifications') {env.SMTP_HOST='${SMTP_HOST:?real SMTP host required}';env.MAIL_FROM='${MAIL_FROM:?sender required}';}
 if(['auth','products','orders','notifications','support','gateway'].includes(name)) s.depends_on['redis-cache']={condition:'service_healthy'};
 if(name==='gateway') {env.COOKIE_SECURE='true';env.ENABLE_API_DOCS='false';}
 if(name==='migrate') {delete env.SEED_ON_START;env.SEED_DEMO_ACCOUNTS='false';s.command=['sh','-ec','npx prisma migrate deploy --schema=libs/prisma/prisma/schema.prisma'];}
 if(name==='redis'||name==='redis-cache') {
   env.REDIS_PASSWORD='${REDIS_PASSWORD:?required}';
   s.command=['sh','-ec',`exec redis-server ${name==='redis'?'--appendonly yes --appendfsync everysec':''} --requirepass "$REDIS_PASSWORD" --maxmemory ${name==='redis'?'512mb':'128mb'} --maxmemory-policy ${name==='redis'?'noeviction':'allkeys-lru'}`.replaceAll('$REDIS_PASSWORD','$$REDIS_PASSWORD')];
   s.healthcheck.test=['CMD-SHELL','REDISCLI_AUTH="$$REDIS_PASSWORD" redis-cli ping | grep -q PONG'];
 }
 if(name==='rabbitmq') s.image='rabbitmq:4.3.6-management-alpine';
 if(name==='nginx') {
   s.image='nginx:1.30.5-alpine';
   s.environment={API_RATE_LIMIT:'${API_RATE_LIMIT:-10}',NGINX_ENVSUBST_FILTER:'API_RATE_LIMIT'};
   s.volumes=['./infra/nginx/nginx.dokploy.conf:/etc/nginx/templates/default.conf.template:ro','./infra/nginx/snippets:/etc/nginx/snippets:ro','./infra/nginx/app-locations.dokploy.conf:/etc/nginx/app-locations.dokploy.conf:ro'];
   s.networks=['default','dokploy-network'];
 } else if(Object.keys(env).length) s.environment=env;
 prod.services[name]=s;
}
fs.writeFileSync('docker-compose.dokploy.yml', '# Configure Dokploy domain on nginx port 80. No public database ports.\n'+yaml.dump(prod,{noRefs:true,lineWidth:120}));
