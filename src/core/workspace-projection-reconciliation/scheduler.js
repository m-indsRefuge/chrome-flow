import { normalizeReconciliationTriggers } from "./planner.js";

export function createReconciliationScheduler({ setTimer, clearTimer, execute, debounceMs }) {
  let timer=null,running=Promise.resolve(),executing=false,queuedTriggers=null,disposed=false;
  const pending=new Set();
  function schedule(trigger="unspecified") {
    if(disposed)return;
    for(const normalized of normalizeReconciliationTriggers([trigger||"unspecified"]))pending.add(normalized);
    if(timer!==null)clearTimer(timer);
    timer=setTimer(()=>{timer=null;const triggers=normalizeReconciliationTriggers([...pending]);pending.clear();if(executing){if(!queuedTriggers)queuedTriggers=new Set();for(const trigger of triggers)queuedTriggers.add(trigger);return;}start(triggers);},debounceMs);
  }
  function start(triggers){executing=true;running=Promise.resolve().then(()=>execute({triggers})).finally(()=>{executing=false;if(queuedTriggers?.size){const next=normalizeReconciliationTriggers([...queuedTriggers]);queuedTriggers=null;start(next);}});}
  function dispose(){disposed=true;if(timer!==null)clearTimer(timer);timer=null;pending.clear();queuedTriggers=null;}
  async function whenIdle(){do{const current=running;try{await current;}catch{}if(current===running&&!executing&&!queuedTriggers)break;}while(true);}
  return Object.freeze({schedule,dispose,whenIdle});
}
