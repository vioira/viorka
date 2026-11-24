import { Monitor } from 'lucide-react';
import alibaba from '@/assets/os-icons/alibaba.svg';
import almalinux from '@/assets/os-icons/almalinux.svg';
import alpinelinux from '@/assets/os-icons/alpinelinux.svg';
import apple from '@/assets/os-icons/apple.svg';
import archlinux from '@/assets/os-icons/archlinux.svg';
import armbian from '@/assets/os-icons/armbian.png';
import centos from '@/assets/os-icons/centos.svg';
import debian from '@/assets/os-icons/debian.svg';
import fedora from '@/assets/os-icons/fedora.svg';
import gentoo from '@/assets/os-icons/gentoo.svg';
import istoreos from '@/assets/os-icons/istoreos.png';
import kali from '@/assets/os-icons/kali.svg';
import linux from '@/assets/os-icons/linux.svg';
import linuxmint from '@/assets/os-icons/linuxmint.svg';
import manjaro from '@/assets/os-icons/manjaro.svg';
import nixos from '@/assets/os-icons/nixos.svg';
import opencloudos from '@/assets/os-icons/opencloudos.svg';
import opensuse from '@/assets/os-icons/opensuse.svg';
import openwrt from '@/assets/os-icons/openwrt.svg';
import oracle from '@/assets/os-icons/oracle.svg';
import proxmox from '@/assets/os-icons/proxmox.png';
import redhat from '@/assets/os-icons/redhat.svg';
import rockylinux from '@/assets/os-icons/rockylinux.svg';
import synology from '@/assets/os-icons/synology.png';
import ubuntu from '@/assets/os-icons/ubuntu.svg';
import windows11 from '@/assets/os-icons/windows11.svg';

const systems: [RegExp, string][] = [
  [/\b(?:alibaba|alinux)\b/i, alibaba],
  [/\barmbian/i, armbian],
  [/\bistore/i, istoreos],
  [/\bkali/i, kali],
  [/\bmanjaro/i, manjaro],
  [/\b(?:linux\s*)?mint\b/i, linuxmint],
  [/\bopencloud/i, opencloudos],
  [/\bopenwrt/i, openwrt],
  [/\boracle/i, oracle],
  [/\b(?:proxmox|pve)\b/i, proxmox],
  [/\b(?:synology|dsm)\b/i, synology],
  [/\balpine/i, alpinelinux],
  [/\bubuntu/i, ubuntu],
  [/\bdebian/i, debian],
  [/\bcentos/i, centos],
  [/\bfedora/i, fedora],
  [/\bred\s*hat|\brhel\b/i, redhat],
  [/\brocky/i, rockylinux],
  [/\barch(?:linux|\b)/i, archlinux],
  [/\bwindows/i, windows11],
  [/\bmac\s*os|\bos x\b|\bdarwin\b/i, apple],
  [/\balma\s*linux/i, almalinux],
  [/\b(?:open)?suse/i, opensuse],
  [/\bnixos/i, nixos],
  [/\bgentoo/i, gentoo],
  [/\blinux\b/i, linux],
];

export function NodeOSIcon({ os }: { os: string }) {
  const src = systems.find(([pattern]) => pattern.test(os))?.[1];
  if (!src) return <Monitor size={15} className="shrink-0" aria-hidden />;
  return (
    <img
      src={src}
      className={
        src === apple || src === linux ? 'shrink-0 in-[[data-theme=dark]]:invert' : 'shrink-0'
      }
      width={15}
      height={15}
      alt=""
    />
  );
}

export function NodeOSLabel({ os }: { os: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
      <NodeOSIcon os={os} />
      <span className="min-w-0 wrap-anywhere">{os || '尚未上报'}</span>
    </span>
  );
}
