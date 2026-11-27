"""Signed, disposable-only APT fixtures. Never use a production inventory."""
from pathlib import Path
import shutil
import subprocess


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kwargs).stdout


def create():
    root = Path('/opt/chalktalk-apt-fixture')
    root.mkdir(mode=0o755)
    code = run('sh', '-c', '. /etc/os-release; printf %s "$VERSION_CODENAME"')
    arch = run('dpkg', '--print-architecture').strip()
    keyhome = root / 'keys'
    keyhome.mkdir(mode=0o700)
    run('gpg', '--homedir', str(keyhome), '--batch', '--pinentry-mode', 'loopback',
        '--passphrase', '', '--quick-generate-key', 'Disposable Acceptance Fixture', 'rsa2048', 'sign', '0')
    public = subprocess.check_output(['gpg', '--homedir', str(keyhome), '--export'])
    keyfile = Path('/usr/share/keyrings/chalktalk-acceptance.gpg')
    keyfile.write_bytes(public)
    keyfile.chmod(0o644)
    groups = {
        'security': ('Ubuntu', code + '-security', ['ct-sec', 'docker', 'docker.io', 'docker-ce',
                    'docker-ce-cli', 'docker-ce-rootless-extras', 'docker-buildx-plugin',
                    'docker-compose-plugin', 'containerd', 'containerd.io', 'runc', 'ct-deferred', 'ct-operator',
                    'docker-ce-acceptance-suffix', 'containerd.io-acceptance-suffix', 'runc-acceptance-suffix',
                    'dockerish', 'containerdish', 'runcish']),
        'esm-apps': ('UbuntuESMApps', code + '-apps-security', ['ct-esm-apps']),
        'esm-infra': ('UbuntuESM', code + '-infra-security', ['ct-esm-infra']),
        'release': ('Ubuntu', code, ['ct-release']),
        'updates': ('Ubuntu', code + '-updates', ['ct-updates', 'ct-dependency']),
        'proposed': ('Ubuntu', code + '-proposed', ['ct-proposed']),
        'backports': ('Ubuntu', code + '-backports', ['ct-backports']),
        'third-party': ('UntrustedFixture', code + '-security', ['ct-third']),
    }
    initial = root / 'initial'
    initial.mkdir()

    def package(name, version, directory, dependency=''):
        build = root / 'build'
        if build.exists():
            shutil.rmtree(build)
        (build / 'DEBIAN').mkdir(parents=True)
        control = (f'Package: {name}\nVersion: {version}\nArchitecture: {arch}\n'
                   'Maintainer: Disposable Fixture <fixture@example.invalid>\n'
                   'Description: harmless disposable security policy acceptance fixture\n')
        if dependency:
            control += f'Depends: {dependency}\n'
        (build / 'DEBIAN/control').write_text(control)
        payload = build / 'usr/share/chalktalk-fixtures'
        payload.mkdir(parents=True)
        (payload / name).write_text(version)
        output = directory / f'{name}_{version}_{arch}.deb'
        run('dpkg-deb', '--build', '--root-owner-group', str(build), str(output))
        return output

    names = []
    for _, _, packages in groups.values():
        for name in packages:
            package(name, '1', initial)
            names.append(name)
    run('dpkg', '-i', *map(str, sorted(initial.glob('*.deb'))))
    sources = []
    for label, (origin, archive, packages) in groups.items():
        directory = root / label
        directory.mkdir(mode=0o755)
        for name in packages:
            package(name, '2', directory, 'ct-dependency (>= 2)' if name == 'ct-deferred' else '')
        (directory / 'Packages').write_text(run('apt-ftparchive', 'packages', '.', cwd=directory))
        (directory / 'Release').write_text(run(
            'apt-ftparchive', '-o', f'APT::FTPArchive::Release::Origin={origin}',
            '-o', f'APT::FTPArchive::Release::Label={origin}',
            '-o', f'APT::FTPArchive::Release::Suite={archive}',
            '-o', f'APT::FTPArchive::Release::Codename={archive}',
            'release', '.', cwd=directory))
        run('gpg', '--homedir', str(keyhome), '--batch', '--yes', '--clearsign',
            '--output', str(directory / 'InRelease'), str(directory / 'Release'))
        sources.append(f'deb [signed-by={keyfile}] file:{directory} ./')
    for path in Path('/etc/apt/sources.list.d').iterdir():
        if path.suffix in ('.sources', '.list'):
            path.rename(path.with_suffix(path.suffix + '.fixture-disabled'))
    Path('/etc/apt/sources.list').write_text('\n'.join(sources) + '\n')
    run('apt-get', 'update', '--error-on=any')
    return names
