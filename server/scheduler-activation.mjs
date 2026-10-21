// Installation stays idle. A user's explicit UI enable is durable across
// worker recovery and DSH restarts, even on legacy bundles with allowScheduler=false.
export function schedulerActivation(settings, update) {
  return {...settings,...update,...(update.enabled===true?{consentVersion:1}:{})};
}
export function shouldStartScheduler(options, settings) {
  return settings?.enabled===true&&(options.allowScheduler===true||settings.consentVersion===1);
}
