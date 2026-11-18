import { Minus, Plus, UsersRound } from 'lucide-react';

export function ServingsControl({value,onChange}: {value:number;onChange:(value:number)=>void}) {
  return <div className="servings-control"><span><UsersRound size={17}/> Servings</span><div><button className="btn-icon" aria-label="Decrease servings" onClick={()=>onChange(Math.max(1,value-1))} disabled={value<=1}><Minus size={17}/></button><label className="sr-only" htmlFor="recipe-servings">Recipe servings</label><input id="recipe-servings" type="number" min="1" max="100" value={value} onChange={e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=1&&n<=100)onChange(n);}}/><button className="btn-icon" aria-label="Increase servings" onClick={()=>onChange(Math.min(100,value+1))} disabled={value>=100}><Plus size={17}/></button></div></div>;
}
