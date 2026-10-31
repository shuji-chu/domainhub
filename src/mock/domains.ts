export type DemoDomain={fqdn:string;suffix:string;note:string;isDemo:true}
export const demoSuffixes=['全部后缀','abrdns.com','de5.net','qd.je','kz.ci','cc.cd']
export const demoDomains:DemoDomain[]=['brightpath.abrdns.com','cloudnest.de5.net','pixelwave.qd.je','northstar.kz.ci','blueorbit.cc.cd','mystudio.abrdns.com'].map(fqdn=>({fqdn,suffix:fqdn.slice(fqdn.indexOf('.')+1),note:'演示数据',isDemo:true}))
