'use client';

import { useRef, useState } from 'react';
import { markPwaInstalled, takeInstallPrompt, usePwaInstall } from '../lib/pwa-install';

function installInstructions(): { title: string; steps: string[] } {
  const userAgent = window.navigator.userAgent;
  const isIPad = window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
  if (/iphone|ipad|ipod/i.test(userAgent) || isIPad) {
    return {
      title: 'No iPhone ou iPad',
      steps: [
        'Abra este site no Safari.',
        'Toque em Compartilhar e escolha “Adicionar à Tela de Início”.',
        'Confirme em Adicionar para abrir o Lívio como aplicativo.',
      ],
    };
  }
  if (/android/i.test(userAgent)) {
    return {
      title: 'No Android',
      steps: [
        'Abra este site no Chrome.',
        'Toque no menu ⋮ e escolha “Instalar app” ou “Adicionar à tela inicial”.',
        'Confirme a instalação para criar o atalho do Lívio.',
      ],
    };
  }
  return {
    title: 'No computador',
    steps: [
      'Abra este site no Chrome ou Edge.',
      'Use o ícone de instalação na barra de endereço ou o menu do navegador.',
      'Confirme para adicionar o Lívio aos seus aplicativos.',
    ],
  };
}

export function InstallAppButton({ className = 'secondary' }: { className?: string }) {
  const { available, installed } = usePwaInstall();
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string>();
  const [instructions, setInstructions] = useState<ReturnType<typeof installInstructions> | null>(
    null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);

  const showInstructions = () => {
    setInstructions(installInstructions());
    dialogRef.current?.showModal();
  };
  const install = async () => {
    setError(undefined);
    const promptEvent = takeInstallPrompt();
    if (!promptEvent) {
      showInstructions();
      return;
    }
    setInstalling(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === 'accepted') markPwaInstalled();
    } catch {
      setError('O navegador não conseguiu iniciar a instalação. Use as instruções abaixo.');
      showInstructions();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <>
      <button className={className} type="button" onClick={() => void install()}>
        {installing
          ? 'Abrindo instalação…'
          : installed
            ? 'Como abrir o aplicativo'
            : available
              ? 'Instalar aplicativo'
              : 'Ver como instalar'}
      </button>
      <dialog className="install-dialog" ref={dialogRef} aria-labelledby="install-title">
        <form method="dialog">
          <button className="install-dialog__close" aria-label="Fechar instruções">
            ×
          </button>
        </form>
        <p className="auth-eyebrow">Acesso rápido</p>
        <h2 id="install-title">
          {installed ? 'Lívio instalado' : 'Adicione o Lívio ao seu dispositivo'}
        </h2>
        <p>
          {installed
            ? 'Procure por Lívio na tela inicial ou na lista de aplicativos.'
            : 'O Lívio pode ser instalado pelo navegador e ficará disponível como um aplicativo.'}
        </p>
        {error && (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        )}
        {instructions && (
          <>
            <h3>{instructions.title}</h3>
            <ol>
              {instructions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </>
        )}
        <p className="install-dialog__note">
          A instalação usa o navegador e mantém o acesso protegido pela sua conta.
        </p>
        <form method="dialog">
          <button className="primary">Entendi</button>
        </form>
      </dialog>
    </>
  );
}
