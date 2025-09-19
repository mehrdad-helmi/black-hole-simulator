import type { GUI } from 'lil-gui';

export const versionNames = {
	schwarzschild: 'Schwarzschild Model',
	assertionDisk: 'Schwarzschild + Assertion Disk + Hot Gas',
};

const versions = {
	schwarzschild: () => window.location.replace('./'),
	assertionDisk: () => window.location.replace('./v2'),
};

export function addVersionFolder(gui: GUI) {
	const versionsGui = gui.addFolder('Versions');
	versionsGui.add(versions, 'schwarzschild').name(versionNames.schwarzschild);
	versionsGui.add(versions, 'assertionDisk').name(versionNames.assertionDisk);
}
