from glob import glob
import os

from setuptools import find_packages, setup

package_name = 'agv_web_bridge'

setup(
    name=package_name,
    version='0.1.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages', ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
        (os.path.join('share', package_name, 'config'), glob('config/*.json') + glob('config/*.yaml')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='AGV Web Simulation',
    maintainer_email='developer@example.com',
    description='ROS 2 communication and authoritative AGV simulation nodes for the web dashboard.',
    license='Proprietary',
    tests_require=['pytest'],
    entry_points={
        'console_scripts': [
            'comm_test_node = agv_web_bridge.comm_test_node:main',
            'navigation_node = agv_web_bridge.navigation_node:main',
            'simulation_node = agv_web_bridge.simulation_node:main',
        ],
    },
)
