import { useState } from 'react';
import { CookingPot, Leaf } from 'lucide-react';
import type { Recipe } from '../domain/schema';

export function RecipeCover({recipe, className = ''}: {recipe: Recipe; className?: string}) {
  const [failed, setFailed] = useState(false);
  const source = recipe.coverImage?.startsWith('https://') ? recipe.coverImage : recipe.coverImage ? `${import.meta.env.BASE_URL}${recipe.coverImage.replace(/^\//, '')}` : undefined;
  return <div className={`recipe-cover ${className}`}>
    {source && !failed ? <img src={source} alt={recipe.name} onError={() => setFailed(true)} /> : <div className="cover-fallback"><span className="fallback-orbit"><Leaf /><CookingPot size={70} strokeWidth={1} /></span><span>FROM YOUR KITCHEN</span><strong>{recipe.name}</strong></div>}
  </div>;
}
