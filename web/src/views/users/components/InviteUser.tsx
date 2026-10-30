import { Plus } from "lucide-react";
import { useState } from "react";
import type { Session } from "@/api/auth";
import { inviteUser, type Role } from "@/api/users";
import { Button } from "@/components/arc/button/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTrigger,
} from "@/components/arc/dialog/dialog";
import { Input } from "@/components/arc/input/input";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
export default function InviteUser({
  session,
  onCreated,
}: {
  session: Session;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [pending, setPending] = useState(false);
  const [, setError] = useToastFeedback("error");
  const [link, setLink] = useState("");
  const [, setNotice] = useToastFeedback("success");
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setLink("");
          setNotice("");
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={session.user.role !== "admin"}>
          <Plus size={16} aria-hidden="true" />
          邀请用户
        </Button>
      </DialogTrigger>
      <DialogContent
        title="邀请用户"
        description="创建 24 小时内有效的一次性邀请链接，由你安全交付给用户。"
      >
        {link ? (
          <div className="space-y-4">
            <Input
              label="邀请链接"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              description="链接仅显示一次，请及时复制。"
            />
            <Button
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setNotice("邀请链接已复制。");
                } catch {
                  setError("无法访问剪贴板，请选中链接后手动复制。");
                }
              }}
            >
              复制邀请链接
            </Button>
            <DialogClose asChild>
              <Button variant="secondary">完成</Button>
            </DialogClose>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (pending) return;
              setPending(true);
              setError("");
              try {
                const invite = await inviteUser(session, name, email, role);
                setLink(`${location.origin}/accept-invitation#${invite.token}`);
                setName("");
                setEmail("");
                await onCreated();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "邀请未创建，请重试。",
                );
              } finally {
                setPending(false);
              }
            }}
          >
            <Input
              label="用户名"
              required
              maxLength={64}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Input
              label="邮箱"
              required
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <SegmentedControl
              label="角色"
              value={role}
              onValueChange={(value) => setRole(value as Role)}
              options={[
                { value: "operator", label: "操作员" },
                { value: "viewer", label: "只读" },
                { value: "admin", label: "管理员" },
              ]}
            />
            <div>
              <Button type="submit" loading={pending}>
                创建邀请
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
