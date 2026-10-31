import { initial } from '@/settings/profile';

export function UserAvatar({ name, avatar, className = '' }: { name: string; avatar?: string | null; className?: string }) {
  return <span className={`user-avatar ${className}`} aria-hidden="true">
    {avatar ? <img src={`data:image/png;base64,${avatar}`} alt="" /> : initial(name)}
  </span>;
}
