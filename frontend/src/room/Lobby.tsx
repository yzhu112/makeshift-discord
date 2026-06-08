import { Volume2 } from 'lucide-react';
import type { User } from '@/api';
import { useAuth } from '@/auth/AuthProvider';
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const ROOMS = [{ name: 'room' }];

type Props = {
  user: User;
  onJoin: (roomName: string) => void;
};

export function Lobby({ user, onJoin }: Props) {
  const { logout } = useAuth();

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4 py-12">
      <Card className="w-full max-w-md gap-0 overflow-hidden border-border/70 py-0 shadow-sm">
        <CardHeader className="space-y-2 border-b bg-muted/40 px-6 py-7">
          <p className="text-[10px] font-medium tracking-[0.22em] text-muted-foreground uppercase">
            Makeshift&nbsp;·&nbsp;Voice
          </p>
          <CardTitle className="font-heading text-3xl font-normal italic tracking-tight">
            Hey, {user.username}.
          </CardTitle>
        </CardHeader>

        <CardContent className="px-6 pt-5 pb-2">
          <p className="mb-3 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Voice channels
          </p>
          <div className="space-y-0.5">
            {ROOMS.map((room) => (
              <button
                key={room.name}
                type="button"
                onClick={() => onJoin(room.name)}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
              >
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{room.name}</span>
              </button>
            ))}
          </div>
        </CardContent>

        <CardFooter className="justify-end px-6 pt-4 pb-6">
          <button
            type="button"
            onClick={logout}
            className="text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Log out
          </button>
        </CardFooter>
      </Card>
    </div>
  );
}
