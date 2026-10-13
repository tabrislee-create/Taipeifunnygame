var RUN = {char:'geek', hard:false, level:1, hp:100, levelStats:{hits:0,kills:0,startMs:0}, inv:{weapon:null, armor:null, boots:null, charms:[null,null]}, charmSeq:0, charmAge:[0,0], buffs:{}, shop:{}, kills:0, deaths:0, startTime:0};
var BASE = {max_hp:150, move_speed:220, jump_velocity:-600, attack_damage:10, attack_cooldown:0.4, attack_range:60, crit_chance:0.05, crit_multiplier:1.5, defense:0, lifesteal:0, attack_speed:0};
var STAT_KEYS = ['max_hp','move_speed','jump_velocity','attack_damage','attack_range','crit_chance','crit_multiplier','defense','lifesteal','attack_speed'];
var RARITY_RANK = {common:0, rare:1, epic:2};
var RARITY_WEIGHTS = [[{common:70,rare:25,epic:5},{common:50,rare:40,epic:10},{common:30,rare:50,epic:20},{common:10,rare:60,epic:30}]];
function rarityTier(level){ if(level<=4)return 0; if(level<=9)return 1; if(level<=14)return 2; return 3; }
function rarityOrder(r){ var d={common:0,rare:1,epic:2}; var keys=['common','rare','epic']; keys.sort(function(a,b){return Math.abs(d[a]-d[r])-Math.abs(d[b]-d[r]);}); return keys; }
function pickRarity(weights){ var total=weights.common+weights.rare+weights.epic; var r=Math.random()*total; if(r<weights.common)return 'common'; if(r<weights.common+weights.rare)return 'rare'; return 'epic'; }
function weightedPick(items,weights){ var w=function(it){var x=weights[it.id];return x==null?1:x;}; var total=0; for(var i=0;i<items.length;i++)total+=w(items[i]); if(total<=0)return items[Math.floor(Math.random()*items.length)]; var r=Math.random()*total; for(var i=0;i<items.length;i++){r-=w(items[i]); if(r<=0)return items[i];} return items[items.length-1]; }
function newRun(charId,hard){ RUN.char=charId||'geek'; RUN.simUses=0; RUN._howto=false; RUN.hard=!!hard; RUN.level=1; RUN.inv={weapon:null,armor:null,boots:null,charms:[null,null]}; RUN.charmSeq=0; RUN.charmAge=[0,0]; RUN.buffs={}; RUN.shop={}; RUN.coins=0; RUN.kills=0; RUN.deaths=0; RUN.levelStats={hits:0,kills:0,startMs:0}; RUN.startTime=Date.now(); var s=calcStats(); RUN.hp=s.max_hp; return RUN; }
function collectMods(){ var E={},B={}; for(var i=0;i<STAT_KEYS.length;i++){var k=STAT_KEYS[i];E[k]={flat:0,percent:0};B[k]={flat:0,percent:0};} var ch=GAME_DATA.characters[RUN.char]; if(ch&&ch.stats)for(var k in ch.stats){var m=ch.stats[k];if(E[k]){if(m.type==='flat')E[k].flat+=m.value;else E[k].percent+=m.value;}} var slots=['weapon','armor','boots']; for(var s=0;s<slots.length;s++){var id=RUN.inv[slots[s]];if(id){var it=GAME_DATA.equipment[id];if(it&&it.stats)for(var k in it.stats){var m=it.stats[k];if(E[k]){if(m.type==='flat')E[k].flat+=m.value;else E[k].percent+=m.value;}}}} for(var c=0;c<2;c++){var id=RUN.inv.charms[c];if(id){var it=GAME_DATA.equipment[id];if(it&&it.stats)for(var k in it.stats){var m=it.stats[k];if(E[k]){if(m.type==='flat')E[k].flat+=m.value;else E[k].percent+=m.value;}}}} for(var bid in RUN.buffs){var stacks=RUN.buffs[bid];if(!stacks)continue;var it=GAME_DATA.buffs[bid];if(it&&it.stats)for(var k in it.stats){var m=it.stats[k];if(B[k]){if(m.type==='flat')B[k].flat+=m.value*stacks;else B[k].percent+=m.value*stacks;}}} shopApplyMods(B); levelBuffApplyMods(B); return {E:E,B:B}; }
function calcStats(){ var mods=collectMods(); var E=mods.E,B=mods.B; var res={}; for(var i=0;i<STAT_KEYS.length;i++){var k=STAT_KEYS[i];var base=BASE[k];var flat=E[k].flat+B[k].flat;res[k]=(base+flat)*(1+E[k].percent)*(1+B[k].percent);} res.attack_speed=E.attack_speed.flat+B.attack_speed.flat+E.attack_speed.percent+B.attack_speed.percent; if(res.attack_speed>1)res.attack_speed=1; if(res.attack_speed<-0.5)res.attack_speed=-0.5; res.attack_cooldown=0.4/(1+res.attack_speed); if(res.attack_cooldown<0.2)res.attack_cooldown=0.2; res.defense_pct=res.defense/100; if(res.crit_chance>1)res.crit_chance=1; if(res.crit_multiplier>5)res.crit_multiplier=5; if(res.move_speed>330)res.move_speed=330; if(res.move_speed<80)res.move_speed=80; if(res.defense_pct>0.8)res.defense_pct=0.8; if(res.defense_pct<0)res.defense_pct=0; if(res.lifesteal>0.3)res.lifesteal=0.3; if(res.jump_velocity<shopJumpLimit())res.jump_velocity=shopJumpLimit(); if(res.jump_velocity>-400)res.jump_velocity=-400; if(res.max_hp<20)res.max_hp=20; var wid=RUN.inv.weapon; res.weapon=wid?GAME_DATA.equipment[wid]:null; return res; }
function difficulty(level){ if(level%5===0)return {hp_mult:1,dmg_mult:1}; if(level<=4)return {hp_mult:1.0,dmg_mult:1.0}; if(level<=9)return {hp_mult:1.2,dmg_mult:1.1}; if(level<=14)return {hp_mult:1.5,dmg_mult:1.3}; if(level<=19)return {hp_mult:2.0,dmg_mult:1.6}; if(level<=24)return {hp_mult:2.4,dmg_mult:1.9}; return {hp_mult:2.8,dmg_mult:2.2}; }
function getHooks(hookName){ var out=[]; var slots=['weapon','armor','boots']; for(var s=0;s<slots.length;s++){var id=RUN.inv[slots[s]];if(id){var it=GAME_DATA.equipment[id];if(it&&it.hooks)for(var i=0;i<it.hooks.length;i++){var h=it.hooks[i];if(h.hook===hookName)out.push({effect:h.effect,params:h.params,source:id});}}} for(var c=0;c<2;c++){var id=RUN.inv.charms[c];if(id){var it=GAME_DATA.equipment[id];if(it&&it.hooks)for(var i=0;i<it.hooks.length;i++){var h=it.hooks[i];if(h.hook===hookName)out.push({effect:h.effect,params:h.params,source:id});}}} for(var bid in RUN.buffs){var stacks=RUN.buffs[bid];if(!stacks)continue;var it=GAME_DATA.buffs[bid];if(it&&it.hooks)for(var i=0;i<it.hooks.length;i++){var h=it.hooks[i];if(h.hook===hookName)for(var s=0;s<stacks;s++)out.push({effect:h.effect,params:h.params,source:bid});}} return out; }
function equipItem(id){ var it=GAME_DATA.equipment[id]; if(!it)return; var slot=it.slot; if(slot==='charm'){ var empty=-1; for(var c=0;c<2;c++){if(RUN.inv.charms[c]===null){empty=c;break;}} if(empty>=0){RUN.inv.charms[empty]=id;RUN.charmAge[empty]=RUN.charmSeq++;} else { var old=0; if(RUN.charmAge[1]<RUN.charmAge[0])old=1; RUN.inv.charms[old]=id; RUN.charmAge[old]=RUN.charmSeq++; } } else { RUN.inv[slot]=id; } var s=calcStats(); if(RUN.hp>s.max_hp)RUN.hp=s.max_hp; }
function addBuff(id){ var it=GAME_DATA.buffs[id]; if(!it)return; RUN.buffs[id]=1; }  // one-shot: ui.js clears RUN.buffs at the next reward pick, so it only covers the next level
function eligibleEquip(it){ var slot=it.slot; if(slot==='charm'){ if(RUN.inv.charms.indexOf(it.id)>=0)return false; var full=RUN.inv.charms[0]!==null&&RUN.inv.charms[1]!==null; if(full){ var older=0; if(RUN.charmAge[1]<RUN.charmAge[0])older=1; var oldId=RUN.inv.charms[older]; var oldIt=GAME_DATA.equipment[oldId]; if(oldIt&&RARITY_RANK[it.rarity]<RARITY_RANK[oldIt.rarity])return false; } } else { if(RUN.inv[slot]===it.id)return false; var curId=RUN.inv[slot]; if(curId){ var curIt=GAME_DATA.equipment[curId]; if(curIt&&RARITY_RANK[it.rarity]<RARITY_RANK[curIt.rarity])return false; } } return true; }
function eligibleBuff(it){ return true; }
function drawChoices(clearedLevel){ if(window.DEMO)return drawChoicesDemo(clearedLevel); var tier=rarityTier(clearedLevel); var weights=RARITY_WEIGHTS[0][tier]; var eqPool=[],buffPool=[]; for(var id in GAME_DATA.equipment){var it=GAME_DATA.equipment[id];if(eligibleEquip(it))eqPool.push(it);} for(var id in GAME_DATA.buffs){var it=GAME_DATA.buffs[id];if(eligibleBuff(it))buffPool.push(it);} var cards=[]; var used={}; var eqCount=0; var buffCount=0; for(var i=0;i<3;i++){ var needBuff=(i===0&&buffCount===0)||(i===2&&buffCount===0); var needEq=(i===0&&eqCount===0)||(i===2&&eqCount===0); var kind; if(needBuff&&buffPool.length>0)kind='buff'; else if(needEq&&eqPool.length>0)kind='equip'; else if(buffPool.length>0&&eqPool.length>0)kind=Math.random()<0.5?'buff':'equip'; else if(buffPool.length>0)kind='buff'; else kind='equip'; var pool=kind==='buff'?buffPool:eqPool; if(pool.length===0){pool=kind==='buff'?eqPool:buffPool;kind=kind==='buff'?'equip':'buff';} var rarity=pickRarity(weights); var order=rarityOrder(rarity); var chosen=null; for(var r=0;r<order.length;r++){var rar=order[r];var sub=[];for(var j=0;j<pool.length;j++){var it=pool[j];if(it.rarity===rar&&!used[it.id])sub.push(it);} if(sub.length>0){chosen=weightedPick(sub,{});break;}} if(!chosen){for(var j=0;j<pool.length;j++){var it=pool[j];if(!used[it.id]){chosen=it;break;}}} if(!chosen)continue; used[chosen.id]=true; var current=null; if(kind==='equip'){ if(chosen.slot==='charm'){ var full=RUN.inv.charms[0]!==null&&RUN.inv.charms[1]!==null; if(full){ var older=0; if(RUN.charmAge[1]<RUN.charmAge[0])older=1; current=GAME_DATA.equipment[RUN.inv.charms[older]]; } } else { var curId=RUN.inv[chosen.slot]; if(curId)current=GAME_DATA.equipment[curId]; } } cards.push({kind:kind,item:chosen,current:current}); if(kind==='equip')eqCount++; else buffCount++; } if(clearedLevel===5||clearedLevel===10||clearedLevel===15||clearedLevel===20||clearedLevel===25){ var hasRare=false; for(var i=0;i<cards.length;i++){if(RARITY_RANK[cards[i].item.rarity]>=1){hasRare=true;break;}} if(!hasRare){ for(var i=0;i<cards.length;i++){ var pool=cards[i].kind==='buff'?buffPool:eqPool; var sub=[]; for(var j=0;j<pool.length;j++){var it=pool[j];if(RARITY_RANK[it.rarity]>=1&&!used[it.id])sub.push(it);} if(sub.length>0){var chosen=weightedPick(sub,{});used[chosen.id]=true;var current=null;if(cards[i].kind==='equip'){if(chosen.slot==='charm'){var full=RUN.inv.charms[0]!==null&&RUN.inv.charms[1]!==null;if(full){var older=0;if(RUN.charmAge[1]<RUN.charmAge[0])older=1;current=GAME_DATA.equipment[RUN.inv.charms[older]];}}else{var curId=RUN.inv[chosen.slot];if(curId)current=GAME_DATA.equipment[curId];}}cards[i]={kind:cards[i].kind,item:chosen,current:current};break;}} } } return cards; }
function applyChoice(card){ if(card.item&&card.item.id==='w_sim_card'){ RUN.simUses=30; return; } if(card.kind==='equip')equipItem(card.item.id); else addBuff(card.item.id); }   // the SIM card does not use the weapon slot: it gives 30 SIM attacks instead of the normal attack (player.js _simAttack)
// Trial build (?demo=1): the reward pool is only these six (user 2026-10-12: the SIM + five picked by the assistant); three distinct ones are offered each time.
var DEMO_REWARD_IDS = ['w_sim_card', 'a_leather_vest', 'b_runner_shoes', 'c_power_ring', 'c_health_amulet', 'buff_vit'];
function demoCardFor(id){ var eq=GAME_DATA.equipment[id], it=eq||GAME_DATA.buffs[id]; if(!it)return null; var kind=eq?'equip':'buff', current=null; if(kind==='equip'){ if(it.slot==='charm'){ var full=RUN.inv.charms[0]!==null&&RUN.inv.charms[1]!==null; if(full){ var older=0; if(RUN.charmAge[1]<RUN.charmAge[0])older=1; current=GAME_DATA.equipment[RUN.inv.charms[older]]; } } else { var cur=RUN.inv[it.slot]; if(cur)current=GAME_DATA.equipment[cur]; } } return {kind:kind,item:it,current:current}; }
function drawChoicesDemo(clearedLevel){ var ok=[],rest=[]; DEMO_REWARD_IDS.forEach(function(id){ var eq=GAME_DATA.equipment[id], it=eq||GAME_DATA.buffs[id]; if(!it)return; var el=id==='w_sim_card'?true:(eq?eligibleEquip(it):eligibleBuff(it)); (el?ok:rest).push(id); }); function shuf(a){ for(var i=a.length-1;i>0;i--){ var j=Math.floor(Math.random()*(i+1)); var t=a[i]; a[i]=a[j]; a[j]=t; } return a; } return shuf(ok).concat(shuf(rest)).slice(0,3).map(demoCardFor); }
// Level buff (user 2026-10-13): a character's weather / time-of-day bonus (characters.json level_buff), active for one level only. RUN.levelBuff is set when the level starts and cleared when it ends.
function levelBuffFor(charId, cond) {
  var ch = GAME_DATA && GAME_DATA.characters && GAME_DATA.characters[charId], lb = ch && ch.level_buff;
  if (!lb || !cond) return null;
  var c = lb.cond || {};
  if (c.wx && c.wx.indexOf(cond.wx) < 0) return null;
  if (c.time && c.time.indexOf(cond.time) < 0) return null;
  return lb;
}
function levelBuffApplyMods(B) {
  var lb = RUN.levelBuff;
  if (!lb || !lb.stats) return;
  for (var k in lb.stats) { var m = lb.stats[k]; if (!B[k]) continue; if (m.type === 'flat') B[k].flat += m.value; else B[k].percent += m.value; }
}
function shopApplyMods(B) {
  if (!GAME_DATA || !GAME_DATA.shop || !RUN.shop) return;
  for (var id in RUN.shop) {
    var item = GAME_DATA.shop[id];
    if (!item) continue;
    if (item.effect_type === 'stat') {
      var key = item.stat_key;
      if (B[key]) {
        if (item.stat_type === 'flat') {
          B[key].flat += item.stat_value;
        } else {
          B[key].percent += item.stat_value;
        }
      }
    }
  }
}

function shopEffect(effectType) {
  if (!GAME_DATA || !GAME_DATA.shop || !RUN.shop) return 0;
  var sum = 0;
  var minVal = Infinity;
  var hasVal = false;
  for (var id in RUN.shop) {
    var item = GAME_DATA.shop[id];
    if (!item) continue;
    if (item.effect_type === effectType) {
      if (effectType === 'shield' || effectType === 'lifesteal_flat') {
        sum += (item.value || 0);
      } else if (effectType === 'skill_cd') {
        var v = item.value || 0;
        if (v < minVal) {
          minVal = v;
          hasVal = true;
        }
      }
    }
  }
  if (effectType === 'skill_cd') {
    return hasVal ? minVal : 0;
  }
  return sum;
}

function shopJumpLimit() {
  if (!GAME_DATA || !GAME_DATA.shop || !RUN.shop) return -700;
  for (var id in RUN.shop) {
    var item = GAME_DATA.shop[id];
    if (item && item.effect_type === 'stat' && item.stat_key === 'jump_velocity') {
      return -850;
    }
  }
  return -700;
}

if (typeof module !== 'undefined') module.exports = {RUN, newRun, calcStats, difficulty, getHooks, equipItem, addBuff, drawChoices, applyChoice};
