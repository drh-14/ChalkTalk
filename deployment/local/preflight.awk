# Restricted literal configuration. Never emit original values in diagnostics.
function fail(key, message) { print "Local configuration: " key " " message > "/dev/stderr"; failed=1; exit 1 }
function value(key, fallback) { return key in settings ? settings[key] : fallback }
function required(key, fallback, result) { result=value(key,fallback); if(result=="")fail(key,"is required"); return result }
function secret(key,fallback,v) {v=required(key,fallback);if(v ~ /^replace-with|^changeme$|^change-me$/)fail(key,"must replace the template placeholder");return v}
function populated(key) { return value(key,"") ~ /[^[:space:]]/ }
function literal(key,v) {
  if(v ~ /[^ -~]/ || v ~ /^[[:space:]]/ || v ~ /[[:space:]]$/ || v ~ /["\047\\$`]/)fail(key,"must use restricted literal syntax (no quoting, expansion, escapes, or controls)")
}
function port(key,fallback,v) { v=value(key,fallback); if(v !~ /^[1-9][0-9]*$/ || length(v)>5 || v+0>65535)fail(key,"must be a canonical decimal port in 1..65535"); if(v in ports)fail(key,"duplicates another published port"); ports[v]=1; return v }
function percent(v,t) { t=v; gsub(/%[0-9A-Fa-f][0-9A-Fa-f]/,"",t); return t !~ /%/ }
function host(v, parts,n,i,label,t,compression,count) {
  if(v ~ /^\[[0-9A-Fa-f:]+\]$/){
    t=substr(v,2,length(v)-2);if(t !~ /:/ || t ~ /:::/ || t ~ /^:[^:]/ || t ~ /[^:]:$/)return 0;
    compression=index(t,"::");if(!compression && (substr(t,1,1)==":" || substr(t,length(t),1)==":"))return 0;if(compression){t=substr(t,1,compression-1) "x" substr(t,compression+2);if(t ~ /::/)return 0;gsub(/x/,":",t)}
    n=split(t,parts,":");count=0;for(i=1;i<=n;i++)if(parts[i]!=""){if(length(parts[i])>4)return 0;count++}
    return compression ? count<8 : count==8;
  }
  if(v ~ /^[0-9.]+$/){n=split(v,parts,".");if(n!=4)return 0;for(i=1;i<=n;i++)if(parts[i] !~ /^(0|[1-9][0-9]*)$/ || parts[i]+0>255)return 0;return 1}
  if(length(v)>253 || v !~ /^[A-Za-z0-9.-]+$/)return 0;
  n=split(v,parts,"."); for(i=1;i<=n;i++){label=parts[i];if(length(label)<1 || length(label)>63 || label !~ /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/)return 0} return 1
}
function url(key,v,db,rest,scheme,authority,path,n,a,h,p,q,query,i,seen,kv) {
  if(v ~ /[[:space:]#]/ || !percent(v) || tolower(v) ~ /%(0[0-9a-f]|1[0-9a-f]|7f|[89a-f][0-9a-f])/ )fail(key,"must be a supported URL with valid percent escapes");
  scheme=v; sub(/:\/\/.*$/,"",scheme); if((db && scheme!="postgres" && scheme!="postgresql") || (!db && scheme!="http" && scheme!="https"))fail(key,"has an unsupported URL scheme");
  rest=substr(v,length(scheme)+4); if(rest==v || rest=="")fail(key,"must be a complete URL");
  authority=rest; sub(/[\/?].*$/,"",authority); path=substr(rest,length(authority)+1);
  if(db){n=split(authority,a,"@");if(n!=2 || a[1] !~ /^[^:]+:[^:]+$/)fail(key,"requires one encoded user/password pair");authority=a[2];if(a[1] ~ /[\[\]]/)fail(key,"requires encoded credentials");
    q=index(path,"?");query=q?substr(path,q+1):"";if(q)path=substr(path,1,q-1);
    if(path !~ /^\/[^\/]+$/)fail(key,"requires one database name");
    if(q && query=="")fail(key,"has an empty query");
    if(query!=""){n=split(query,a,"&");delete seen;for(i=1;i<=n;i++){if(split(a[i],kv,"=")!=2 || kv[1]!="sslmode" || kv[1] in seen || kv[2] !~ /^(disable|require|verify-ca|verify-full)$/)fail(key,"supports only one noncontradictory sslmode query parameter");seen[kv[1]]=1}}
  } else if(authority ~ /@/ || path ~ /[?#]/)fail(key,"must not contain credentials, query, or fragment");
  h=authority;p="";
  if(substr(h,1,1)=="["){q=index(h,"]");if(!q)fail(key,"has an invalid host");p=substr(h,q+1);h=substr(h,1,q);if(p!="" && substr(p,1,1)!=":")fail(key,"has an invalid port");if(p==":")fail(key,"has an empty port");if(p!="")p=substr(p,2)}
  else {n=split(h,a,":");if(n>2)fail(key,"requires brackets around IPv6");h=a[1];if(n==2){p=a[2];if(p=="")fail(key,"has an empty port")}}
  if(!host(h))fail(key,"has an invalid host");if(p!="" && (p !~ /^[1-9][0-9]*$/ || length(p)>5 || p+0>65535))fail(key,"has an invalid port");
}
function encode(v,out,i,c) {out="";for(i=1;i<=length(v);i++){c=substr(v,i,1);out=out (c ~ /^[A-Za-z0-9_.~-]$/ ? c : sprintf("%%%02X",ascii[c]))}return out}
function emit(key,v) { print key "=" v > runtime }
BEGIN {
  for(i=32;i<127;i++)ascii[sprintf("%c",i)]=i;
  keys="LOCAL_DATABASE_ENABLED LOCAL_OBJECT_STORE_ENABLED LOCAL_DATABASE_USER LOCAL_DATABASE_PASSWORD LOCAL_DATABASE_NAME LOCAL_OBJECT_STORE_ACCESS_KEY_ID LOCAL_OBJECT_STORE_SECRET_ACCESS_KEY LOCAL_OBJECT_STORE_BUCKET LOCAL_OBJECT_STORE_REGION LOCAL_DATABASE_HOST_PORT LOCAL_OBJECT_STORE_HOST_PORT DATABASE_URL S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_SESSION_TOKEN AUTH_TOKEN_SECRET METRICS_TOKEN GRAFANA_ADMIN_PASSWORD DOMAIN WEB_PORT GRAFANA_PORT EMAIL_PROVIDER EMAIL_FROM RESEND_API_KEY RESEND_API_BASE_URL SENDGRID_API_KEY SES_REGION SES_CREDENTIALS_MODE SES_ACCESS_KEY_ID SES_SECRET_ACCESS_KEY SES_SESSION_TOKEN SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_FROM PORT PROD PRODUCTION LOCAL_DATABASE LOCAL_FILE_STORE SEAWEEDFS_ACCESS_KEY_ID SEAWEEDFS_SECRET_ACCESS_KEY EMBEDDING_API_KEY EMBEDDING_BASE_URL EMBEDDING_MODEL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN AWS_ROLE_SESSION_NAME AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_AUTHORIZATION_TOKEN AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE";
  keys=keys " EMAIL_API_BASE_URL EMAIL_GATEWAY_URL SENDGRID_API_BASE_URL SES_ENDPOINT SES_ENDPOINT_URL AWS_ENDPOINT_URL AWS_ENDPOINT_URL_SES_V2";
  n=split(keys,list," ");for(i=1;i<=n;i++){known[list[i]]=1;if(list[i] in ENVIRON)settings[list[i]]=ENVIRON[list[i]]}
}
/^[[:space:]]*$/ {next}
/^#/ {next}
{
  equal=index($0,"=");key=substr($0,1,equal-1);v=substr($0,equal+1);
  if(!equal || key !~ /^[A-Z_][A-Z0-9_]*$/)fail("line " NR,"must be a literal KEY=value assignment");
  if(!(key in known))fail(key,"is unsupported; remove it");if(key in filekeys)fail(key,"is duplicated");filekeys[key]=1;settings[key]=v;
}
END {
  if(failed)exit 1;
  for(key in settings)literal(key,settings[key]);
  for(i=1;i<=split("PORT PROD PRODUCTION LOCAL_DATABASE LOCAL_FILE_STORE SEAWEEDFS_ACCESS_KEY_ID SEAWEEDFS_SECRET_ACCESS_KEY EMAIL_API_BASE_URL EMAIL_GATEWAY_URL SENDGRID_API_BASE_URL SES_ENDPOINT SES_ENDPOINT_URL AWS_ENDPOINT_URL AWS_ENDPOINT_URL_SES_V2",a," ");i++)if(a[i] in settings)fail(a[i],"is obsolete; use the canonical local template");
  db=value("LOCAL_DATABASE_ENABLED","true");store=value("LOCAL_OBJECT_STORE_ENABLED","true");
  if(db!="true" && db!="false")fail("LOCAL_DATABASE_ENABLED","must be true or false");
  if(store!="true" && store!="false")fail("LOCAL_OBJECT_STORE_ENABLED","must be true or false");
  domain=value("DOMAIN","localhost");if(!host(domain) || domain ~ /^\[/)fail("DOMAIN","must be a DNS hostname or IPv4 address");
  web=port("WEB_PORT","5173");grafana=port("GRAFANA_PORT","3001");
  for(i=1;i<=split("LOCAL_DATABASE_HOST_PORT LOCAL_OBJECT_STORE_HOST_PORT",a," ");i++)if(a[i] in settings){if((i==1?db:store)!="true")fail(a[i],"cannot publish a disabled service");port(a[i],"")}
  for(i=1;i<=split("AUTH_TOKEN_SECRET METRICS_TOKEN GRAFANA_ADMIN_PASSWORD",a," ");i++){v=required(a[i],"");if(v ~ /replace-with|changeme|change-me/)fail(a[i],"must replace the template placeholder");if(i<3 && length(v)<32)fail(a[i],"must contain at least 32 characters")}
  if(db=="true"){if(populated("DATABASE_URL"))fail("DATABASE_URL","conflicts with bundled database; remove it or disable LOCAL_DATABASE_ENABLED");database="postgresql://" encode(required("LOCAL_DATABASE_USER","chalktalk")) ":" encode(required("LOCAL_DATABASE_PASSWORD","chalktalk")) "@postgres:5432/" encode(required("LOCAL_DATABASE_NAME","chalktalk"))}
  else {database=required("DATABASE_URL","");url("DATABASE_URL",database,1)}
  n=split("S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_SESSION_TOKEN",a," ");
  if(store=="true"){for(i=1;i<=n;i++)if(populated(a[i]))fail(a[i],"conflicts with bundled object store; remove it or disable LOCAL_OBJECT_STORE_ENABLED")}
  else {for(i=1;i<=5;i++)required(a[i],"");url("S3_ENDPOINT",settings["S3_ENDPOINT"],0)}
  provider=required("EMAIL_PROVIDER","");if(provider !~ /^(resend|sendgrid|ses)$/)fail("EMAIL_PROVIDER","must be resend, sendgrid, or ses");
  from=required("EMAIL_FROM","");mailbox=from;
  if(from ~ /</){if(from !~ /^[^<>,;]+ <[^<>]+>$/)fail("EMAIL_FROM","must be one mailbox");sub(/^.* </,"",mailbox);sub(/>$/,"",mailbox)}
  if(mailbox !~ /^[A-Za-z0-9!#%&*+\/=?^_{}|~-]+(\.[A-Za-z0-9!#%&*+\/=?^_{}|~-]+)*@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/)fail("EMAIL_FROM","must be one mailbox");
  split(mailbox,senderparts,"@");if(!host(senderparts[2]) || length(senderparts[1])>64 || length(mailbox)>254)fail("EMAIL_FROM","must be one valid mailbox");
  n=split("RESEND_API_KEY RESEND_API_BASE_URL SENDGRID_API_KEY SES_REGION SES_CREDENTIALS_MODE SES_ACCESS_KEY_ID SES_SECRET_ACCESS_KEY SES_SESSION_TOKEN SMTP_HOST SMTP_PORT SMTP_SECURE SMTP_USER SMTP_PASSWORD SMTP_FROM",a," ");
  for(i=1;i<=n;i++)if(populated(a[i]) && ((i<=2 && provider!="resend") || (i==3 && provider!="sendgrid") || (i>=4 && i<=8 && provider!="ses") || i>=9))fail(a[i],"belongs to an unselected or unsupported mail provider");
  if(provider=="resend"){secret("RESEND_API_KEY","");if(("RESEND_API_BASE_URL" in settings) && settings["RESEND_API_BASE_URL"]!="https://api.resend.com" && settings["RESEND_API_BASE_URL"]!="https://api.resend.com/")fail("RESEND_API_BASE_URL","must use the official HTTPS origin")}
  if(provider=="sendgrid")secret("SENDGRID_API_KEY","");
  if(provider=="ses"){
    if(required("SES_REGION","") !~ /^[a-z][a-z](-[a-z]+)+-[0-9]+$/)fail("SES_REGION","must be an AWS region");mode=required("SES_CREDENTIALS_MODE","");
    if(mode=="explicit"){secret("SES_ACCESS_KEY_ID","");secret("SES_SECRET_ACCESS_KEY","")}
    else if(mode=="default-chain"){for(i=1;i<=split("SES_ACCESS_KEY_ID SES_SECRET_ACCESS_KEY SES_SESSION_TOKEN",a," ");i++)if(populated(a[i]))fail(a[i],"must be absent in default-chain mode")}
    else fail("SES_CREDENTIALS_MODE","must be explicit or default-chain")
  }
  if(populated("AWS_PROFILE") && settings["AWS_PROFILE"] !~ /^[A-Za-z0-9_.-]+$/)fail("AWS_PROFILE","must be a profile identifier");
  if(populated("AWS_CONTAINER_CREDENTIALS_FULL_URI"))url("AWS_CONTAINER_CREDENTIALS_FULL_URI",settings["AWS_CONTAINER_CREDENTIALS_FULL_URI"],0);
  if(populated("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI") && settings["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"] !~ /^\/[A-Za-z0-9_.\/-]+$/)fail("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI","must be a source path");
  if(populated("AWS_ACCESS_KEY_ID") != populated("AWS_SECRET_ACCESS_KEY"))fail("AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY","must be supplied together");
  if(populated("EMBEDDING_API_KEY")){if("EMBEDDING_BASE_URL" in settings){url("EMBEDDING_BASE_URL",settings["EMBEDDING_BASE_URL"],0);if(settings["EMBEDDING_BASE_URL"] !~ /^https:\/\// && settings["EMBEDDING_BASE_URL"] !~ /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?\//)fail("EMBEDDING_BASE_URL","must use HTTPS outside localhost")};if(length(value("EMBEDDING_MODEL",""))>200)fail("EMBEDDING_MODEL","is too long")}
  # Only validated allowlisted application settings cross the boundary.
  n=split("AUTH_TOKEN_SECRET METRICS_TOKEN EMAIL_PROVIDER EMAIL_FROM RESEND_API_KEY RESEND_API_BASE_URL SENDGRID_API_KEY SES_REGION SES_CREDENTIALS_MODE SES_ACCESS_KEY_ID SES_SECRET_ACCESS_KEY SES_SESSION_TOKEN EMBEDDING_API_KEY EMBEDDING_BASE_URL EMBEDDING_MODEL AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_ROLE_ARN AWS_ROLE_SESSION_NAME AWS_CONTAINER_CREDENTIALS_RELATIVE_URI AWS_CONTAINER_CREDENTIALS_FULL_URI AWS_CONTAINER_AUTHORIZATION_TOKEN",a," ");
  for(i=1;i<=n;i++)if(a[i] in settings)emit(a[i],settings[a[i]]);
  emit("NODE_ENV","development");emit("DATABASE_URL",database);emit("FRONTEND_ORIGINS","https://" domain ":" web);emit("FRONTEND_BASE_URL","https://" domain ":" web);emit("TRUST_PROXY_HOPS","1");emit("LOG_SPOOL_DIRECTORY","/var/log/chalktalk");emit("AWS_EC2_METADATA_DISABLED","true");
  if(store=="true"){emit("S3_ENDPOINT","http://seaweedfs:8333");emit("S3_BUCKET",required("LOCAL_OBJECT_STORE_BUCKET","chalktalk-resources"));emit("S3_REGION",required("LOCAL_OBJECT_STORE_REGION","us-east-1"));emit("S3_ACCESS_KEY_ID",required("LOCAL_OBJECT_STORE_ACCESS_KEY_ID","chalktalk-local"));emit("S3_SECRET_ACCESS_KEY",required("LOCAL_OBJECT_STORE_SECRET_ACCESS_KEY","chalktalk-local-secret"))}
  else for(i=1;i<=split("S3_ENDPOINT S3_BUCKET S3_REGION S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY S3_SESSION_TOKEN",a," ");i++)if(a[i] in settings)emit(a[i],settings[a[i]]);
  n=split("AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_WEB_IDENTITY_TOKEN_FILE AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE",a," ");
  for(i=1;i<=n;i++)if(provider=="ses" && mode=="default-chain" && populated(a[i])){
    if(settings[a[i]] !~ /^\/[A-Za-z0-9_.\/-]+$/ || settings[a[i]] ~ /\/\.\.(\/|$)/)fail(a[i],"must select one absolute file path without traversal");
    print a[i] "=" settings[a[i]] > sources;
    emit(a[i],"/run/chalktalk-aws/" a[i]);
  }
  print db > topology;print store >> topology;
  # Compose interpolation input is private and distinct from the operator file.
  emit("DOMAIN",domain);emit("WEB_PORT",web);emit("GRAFANA_PORT",grafana);emit("GRAFANA_ADMIN_PASSWORD",settings["GRAFANA_ADMIN_PASSWORD"]);
  emit("LOCAL_DATABASE_USER",required("LOCAL_DATABASE_USER","chalktalk"));emit("LOCAL_DATABASE_PASSWORD",required("LOCAL_DATABASE_PASSWORD","chalktalk"));emit("LOCAL_DATABASE_NAME",required("LOCAL_DATABASE_NAME","chalktalk"));
  for(i=1;i<=split("LOCAL_DATABASE_HOST_PORT LOCAL_OBJECT_STORE_HOST_PORT",a," ");i++)if(a[i] in settings)emit(a[i],settings[a[i]]);
}
